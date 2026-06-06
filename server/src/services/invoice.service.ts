import prisma from '../utils/prisma';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface InvoiceData {
    orderId: number;
    customerName?: string;
    customerRuc?: string;
    items: Array<{ name: string; quantity: number; price: number; subtotal: number }>;
    subtotal: number;
    tax: number;
    tipAmount: number;
    tipRatePercent: number;
    total: number;
    branchName: string;
    branchAddress?: string;
    branchPhone?: string;
    companyName: string;
    companyRuc?: string;
    date: Date;
    invoiceNumber: string;
    taxRatePercent: number;
}

export class InvoiceService {
    private static DEFAULT_IVA_RATE = 0.15;

    private static async getIvaRate(companyId: number): Promise<number> {
        const { SettingService } = await import('./setting.service');
        const settings = await SettingService.getAll(companyId);
        const taxRate = parseFloat(settings['tax_rate'] || settings['taxRate'] || '');
        return Number.isFinite(taxRate) && taxRate >= 0 ? taxRate / 100 : this.DEFAULT_IVA_RATE;
    }

    private static async getTipSettings(companyId: number): Promise<{ tipEnabled: boolean; tipRate: number }> {
        const { SettingService } = await import('./setting.service');
        const settings = await SettingService.getAll(companyId);
        const tipEnabled = settings['tipEnabled'] === 'true';
        const tipRate = parseFloat(settings['tipRate'] || '0');
        return { tipEnabled, tipRate: Number.isFinite(tipRate) ? tipRate : 0 };
    }

    private static async ensureInvoiceNumber(orderId: number, companyId: number, branchId: number): Promise<string> {
        return prisma.$transaction(async (tx) => {
            // Lock the order row FOR UPDATE so two concurrent invoice generations for the
            // SAME order can't each consume a sequence number / assign a different invoice.
            const locked = await tx.$queryRaw<{ id: number; invoiceNumber: string | null }[]>`
                SELECT \`id\`, \`invoiceNumber\` FROM \`Order\`
                WHERE \`id\` = ${orderId} AND \`companyId\` = ${companyId}
                FOR UPDATE`;

            if (locked.length === 0) {
                throw new Error('Order not found or unauthorized');
            }
            if (locked[0].invoiceNumber) {
                return locked[0].invoiceNumber;
            }

            await tx.invoiceSequence.upsert({
                where: {
                    companyId_branchId: {
                        companyId,
                        branchId
                    }
                },
                update: {},
                create: {
                    companyId,
                    branchId,
                    lastNumber: 0
                }
            });

            const sequence = await tx.invoiceSequence.update({
                where: {
                    companyId_branchId: {
                        companyId,
                        branchId
                    }
                },
                data: {
                    lastNumber: {
                        increment: 1
                    }
                }
            });

            const invoiceNumber = `FAC-${branchId}-${sequence.lastNumber.toString().padStart(6, '0')}`;

            await tx.order.update({
                where: { id: orderId },
                data: { invoiceNumber }
            });

            return invoiceNumber;
        });
    }

    static async generateInvoice(orderId: number, companyId: number) {
        // Check order status before consuming an invoice number
        const orderCheck = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            select: { status: true }
        });
        if (!orderCheck) throw new Error('Order not found');
        if (orderCheck.status !== 'PAID') {
            throw new Error(`Only paid orders can be invoiced. Current status: ${orderCheck.status}`);
        }

        let order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                branch: {
                    include: {
                        company: true
                    }
                },
                items: {
                    include: {
                        menuItem: true
                    }
                },
                user: true
            }
        });

        if (!order) {
            throw new Error('Order not found or unauthorized');
        }

        const invoiceNumber = order.invoiceNumber
            || await this.ensureInvoiceNumber(order.id, companyId, order.branchId);

        if (!order.invoiceNumber) {
            order = await prisma.order.findFirst({
                where: { id: orderId, companyId },
                include: {
                    branch: {
                        include: {
                            company: true
                        }
                    },
                    items: {
                        include: {
                            menuItem: true
                        }
                    },
                    user: true
                }
            });
        }

        if (!order) {
            throw new Error('Order not found or unauthorized');
        }

        const ivaRate = await this.getIvaRate(companyId);
        const tipSettings = await this.getTipSettings(companyId);
        const itemSubtotal = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
        const discount = Number(order.discount || 0);
        const subtotal = Math.max(0, itemSubtotal - discount);
        const tax = Number(order.tax || 0);
        const tipAmount = Number(order.tipAmount || 0);

        const taxRatePercent = subtotal > 0
            ? Math.round((tax / subtotal) * 10000) / 100
            : Math.round(ivaRate * 10000) / 100;

        const tipRatePercent = tipAmount > 0 && subtotal > 0
            ? Math.round((tipAmount / subtotal) * 10000) / 100
            : tipSettings.tipRate;

        const invoiceData: InvoiceData = {
            orderId: order.id,
            customerName: order.customerName || 'Consumidor Final',
            customerRuc: 'N/A',
            items: order.items.map((item) => ({
                name: item.menuItem.name,
                quantity: item.quantity,
                price: Number(item.price),
                subtotal: Number(item.subtotal)
            })),
            subtotal,
            tax,
            tipAmount,
            tipRatePercent,
            total: Number(order.total),
            branchName: order.branch.name,
            branchAddress: order.branch.address ?? undefined,
            branchPhone: order.branch.phone ?? undefined,
            companyName: order.branch.company.name,
            companyRuc: order.branch.company.ruc ?? undefined,
            date: order.createdAt,
            invoiceNumber,
            taxRatePercent
        };

        return invoiceData;
    }

    static async generateInvoicePDF(orderId: number, companyId: number): Promise<Buffer> {
        const data = await this.generateInvoice(orderId, companyId);

        const doc = new jsPDF();
        const margin = 15;

        doc.setFontSize(20);
        doc.text(data.companyName, margin, 20);

        doc.setFontSize(10);
        doc.text(`RUC: ${data.companyRuc || 'N/A'}`, margin, 27);
        doc.text(`${data.branchName}`, margin, 32);
        if (data.branchAddress) doc.text(data.branchAddress, margin, 37);
        if (data.branchPhone) doc.text(`Tel: ${data.branchPhone}`, margin, 42);

        doc.setFontSize(12);
        doc.text(`FACTURA: ${data.invoiceNumber}`, 140, 20);
        doc.text(`FECHA: ${data.date.toLocaleDateString()}`, 140, 27);
        doc.text(`ORDEN: #${data.orderId}`, 140, 34);

        doc.setDrawColor(200);
        doc.line(margin, 50, 195, 50);
        doc.text(`CLIENTE: ${data.customerName}`, margin, 60);
        doc.text(`RUC/Cedula: ${data.customerRuc}`, margin, 67);
        doc.line(margin, 72, 195, 72);

        const tableData = data.items.map(item => [
            item.name,
            item.quantity.toString(),
            item.price.toFixed(2),
            item.subtotal.toFixed(2)
        ]);

        autoTable(doc, {
            head: [['Descripcion', 'Cant.', 'Precio', 'Subtotal']],
            body: tableData,
            startY: 80,
            margin: { left: margin, right: margin },
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            columnStyles: {
                1: { halign: 'center' },
                2: { halign: 'right' },
                3: { halign: 'right' }
            }
        });

        const docWithTable = doc as jsPDF & { lastAutoTable: { finalY: number } };
        const finalY = docWithTable.lastAutoTable.finalY + 10;

        doc.text(`Subtotal:`, 140, finalY);
        doc.text(`${data.subtotal.toFixed(2)}`, 195, finalY, { align: 'right' });

        doc.text(`IVA (${data.taxRatePercent}%):`, 140, finalY + 7);
        doc.text(`${data.tax.toFixed(2)}`, 195, finalY + 7, { align: 'right' });

        let tipOffset = 0;
        if (data.tipAmount > 0) {
            tipOffset = 7;
            doc.text(`Propina (${data.tipRatePercent}%):`, 140, finalY + 14);
            doc.text(`${data.tipAmount.toFixed(2)}`, 195, finalY + 14, { align: 'right' });
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL:`, 140, finalY + 16 + tipOffset);
        doc.text(`C$ ${data.total.toFixed(2)}`, 195, finalY + 16 + tipOffset, { align: 'right' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('¡Gracias por su compra!', 105, finalY + 30 + tipOffset, { align: 'center' });

        return Buffer.from(doc.output('arraybuffer'));
    }
}
