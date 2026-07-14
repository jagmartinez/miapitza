import prisma from '../utils/prisma';
import { formatCurrency } from '../utils/currency';
import { SettingService } from './setting.service';

/** Shape produced by generateOrderTicket / consumed by formatForPrinter */
export interface PrintableOrderTicket {
    header: {
        businessName: string;
        ruc: string;
        address: string;
        phone: string;
        branch: string;
        currency_symbol: string;
        logoUrl: string;
    };
    order: {
        financialStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
        number: string;
        date: Date;
        type: string;
        table: string | number;
        waiter: string;
        customerName: string;
    };
    items: Array<{
        name: string;
        quantity: number;
        price: number;
        subtotal: number;
        modifiers: Array<{ name: string; price: number }>;
    }>;
    totals: {
        subtotal: number;
        discount: number;
        discountCode: string | null;
        tip: number;
        tax: number;
        total: number;
    };
    payments: Array<{ method: string; amount: number; reference: string | null | undefined }>;
    footer: { message: string; printedAt: string };
}

/**
 * Ticket Printing Service
 * Generates printable ticket data for orders
 */
export class TicketPrintingService {
    static async getOrderBranch(orderId: number, companyId: number): Promise<number> {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            select: { branchId: true }
        });
        if (!order) throw new Error('Orden no encontrada');
        return order.branchId;
    }

    /**
     * Generate order ticket data
     */
    static async generateOrderTicket(orderId: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                items: {
                    include: {
                        menuItem: true,
                        modifiers: true
                    }
                },
                table: true,
                user: { select: { name: true } },
                branch: true,
                payments: {
                    where: { status: 'ACTIVE' },
                    include: { paymentMethod: true }
                }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const [settings, company] = await Promise.all([
            SettingService.getAll(companyId),
            prisma.company.findUnique({ where: { id: companyId }, select: { ruc: true } })
        ]);

        const getSettingValue = (key: string, defaultValue: string) => {
            let value = settings[key];

            // Map legacy or internal keys to the standard frontend keys
            if (value === undefined) {
                if (key === 'business_name') value = settings['companyName'];
                if (key === 'ruc') value = settings['nif'];
                if (key === 'ticket_footer') value = settings['invoiceFooter'];
            }

            return value || defaultValue;
        };


        // Single source of truth for the tax id: Company.ruc (settings only as fallback).
        const ticket = {
            header: {
                businessName: getSettingValue('business_name', 'Restaurante'),
                ruc: company?.ruc || getSettingValue('ruc', ''),
                address: getSettingValue('address', ''),
                phone: getSettingValue('phone', ''),
                branch: order.branch?.name || '',
                currency_symbol: getSettingValue('currency_symbol', '$'),
                logoUrl: getSettingValue('logoUrl', '')
            },
            order: {
                financialStatus: order.financialStatus,
                number: order.id.toString().padStart(6, '0'),
                date: order.createdAt,
                type: order.orderType || 'DINE_IN',
                table: order.table?.number || 'N/A',
                waiter: order.user?.name || '',
                customerName: order.customerName || ''
            },
            items: order.items.map((item) => ({
                name: item.menuItem.name,
                quantity: item.quantity,
                price: Number(item.price),
                subtotal: Number(item.subtotal),
                modifiers:
                    item.modifiers?.map((m) => ({
                        name: m.name,
                        price: Number(m.price)
                    })) || []
            })),
            totals: {
                subtotal: order.items.reduce((sum, item) => sum + Number(item.subtotal), 0),
                discount: Number(order.discount || 0),
                discountCode: order.discountCode || null,
                tip: Number(order.tipAmount || 0),
                tax: Number(order.tax || 0),
                total: Number(order.total)
            },
            payments: order.payments.map((p) => ({
                method: p.paymentMethod?.name || 'Efectivo',
                amount: Number(p.amount),
                reference: p.reference
            })),
            footer: {
                message: getSettingValue('ticket_footer', '¡Gracias por su visita!'),
                printedAt: new Date().toISOString()
            }
        };

        return ticket;
    }

    /**
     * Generate kitchen ticket (only items, no prices)
     */
    static async generateKitchenTicket(orderId: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                items: {
                    include: {
                        menuItem: true,
                        modifiers: true
                    }
                },
                table: true,
                user: { select: { name: true } }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        return {
            orderNumber: order.id.toString().padStart(6, '0'),
            table: order.table?.number || 'PARA LLEVAR',
            waiter: order.user?.name || '',
            time: order.createdAt,
            items: order.items.map((item) => ({
                quantity: item.quantity,
                name: item.menuItem.name,
                modifiers: item.modifiers?.map((m) => m.name) || [],
                notes: item.notes || ''
            })),
            notes: order.customerName ? `Cliente: ${order.customerName}` : ''
        };
    }

    /**
     * Format ticket for thermal printer (58mm/80mm)
     */
    static formatForPrinter(ticketData: PrintableOrderTicket, printerWidth: 58 | 80 = 80): string {
        const charWidth = printerWidth === 58 ? 32 : 48;
        const separator = '='.repeat(charWidth);
        const dashedLine = '-'.repeat(charWidth);

        const center = (text: string) => {
            const padding = Math.max(0, Math.floor((charWidth - text.length) / 2));
            return ' '.repeat(padding) + text;
        };

        const formatLine = (left: string, right: string) => {
            const spaces = charWidth - left.length - right.length;
            return left + ' '.repeat(Math.max(1, spaces)) + right;
        };

        const lines: string[] = [];

        // Header
        lines.push(center(ticketData.header.businessName));
        if (ticketData.header.ruc) lines.push(center(`RUC: ${ticketData.header.ruc}`));
        if (ticketData.header.address) lines.push(center(ticketData.header.address));
        if (ticketData.header.phone) lines.push(center(`Tel: ${ticketData.header.phone}`));
        lines.push(separator);

        // Order info
        lines.push(`Orden #: ${ticketData.order.number}`);
        lines.push(`Fecha: ${new Date(ticketData.order.date).toLocaleString()}`);
        lines.push(`Mesa: ${ticketData.order.table}`);
        lines.push(`Mesero: ${ticketData.order.waiter}`);
        if (ticketData.order.customerName) {
            lines.push(`Cliente: ${ticketData.order.customerName}`);
        }
        lines.push(dashedLine);

        // Items
        for (const item of ticketData.items) {
            lines.push(formatLine(
                `${item.quantity}x ${item.name}`,
                formatCurrency(item.subtotal, ticketData.header)
            ));
            for (const mod of item.modifiers) {
                lines.push(`  + ${mod.name} ${formatCurrency(mod.price, ticketData.header)}`);
            }
        }
        lines.push(dashedLine);

        // Totals
        lines.push(formatLine('Subtotal:', formatCurrency(ticketData.totals.subtotal, ticketData.header)));
        if (ticketData.totals.discount > 0) {
            lines.push(formatLine('Descuento:', `-${formatCurrency(ticketData.totals.discount, ticketData.header)}`));
        }
        if (ticketData.totals.tax > 0) {
            lines.push(formatLine('Impuesto:', formatCurrency(ticketData.totals.tax, ticketData.header)));
        }
        if (ticketData.totals.tip > 0) {
            lines.push(formatLine('Propina:', formatCurrency(ticketData.totals.tip, ticketData.header)));
        }
        lines.push(separator);
        lines.push(formatLine('TOTAL:', formatCurrency(ticketData.totals.total, ticketData.header)));
        lines.push(separator);

        // Payments
        for (const payment of ticketData.payments) {
            lines.push(formatLine(payment.method, formatCurrency(payment.amount, ticketData.header)));
        }

        // Footer
        lines.push('');
        lines.push(center(ticketData.footer.message));
        lines.push('');

        return lines.join('\n');
    }
}
