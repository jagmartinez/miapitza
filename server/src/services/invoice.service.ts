import type { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import prisma from '../utils/prisma';
import { DEFAULT_COMPANY_SETTINGS, SettingService, validateConfiguredFiscalTaxId } from './setting.service';

export interface InvoiceData {
    orderId: number;
    customerName?: string;
    customerRuc?: string;
    customerTaxIdType?: string;
    customerFiscalAddress?: string;
    customerEmail?: string;
    customerPhone?: string;
    items: Array<{ orderItemId?: number; name: string; quantity: number; price: number; subtotal: number }>;
    grossSubtotal: number;
    discount: number;
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
    currencySymbol: string;
}

const invoiceOrderInclude = {
    branch: { include: { company: true } },
    items: { include: { menuItem: true } },
} satisfies Prisma.OrderInclude;

type InvoiceOrder = Prisma.OrderGetPayload<{ include: typeof invoiceOrderInclude }>;

function finiteNumber(value: unknown, field: string): number {
    if (value == null) {
        throw new Error(`Invoice snapshot is invalid: ${field}`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`Invoice snapshot is invalid: ${field}`);
    }
    return number;
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invoice snapshot is invalid: ${field}`);
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function moneyCents(value: number): number {
    return Math.round(value * 100);
}

function assertInvoiceReconciles(data: InvoiceData, label: string): void {
    const amounts = [
        data.grossSubtotal,
        data.discount,
        data.subtotal,
        data.tax,
        data.tipAmount,
        data.total,
    ];
    if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
        throw new Error(`${label} totals do not reconcile`);
    }
    for (const item of data.items) {
        if (
            (item.orderItemId !== undefined && (!Number.isInteger(item.orderItemId) || item.orderItemId <= 0))
            || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.price < 0 || item.subtotal < 0
        ) {
            throw new Error(`${label} totals do not reconcile`);
        }
        if (moneyCents(item.price * item.quantity) !== moneyCents(item.subtotal)) {
            throw new Error(`${label} totals do not reconcile`);
        }
    }
    const grossSubtotal = data.items.reduce((sum, item) => sum + item.subtotal, 0);
    const netSubtotal = Math.max(0, data.grossSubtotal - data.discount);
    if (
        moneyCents(grossSubtotal) !== moneyCents(data.grossSubtotal)
        || data.discount > data.grossSubtotal
        || moneyCents(netSubtotal) !== moneyCents(data.subtotal)
        || moneyCents(data.subtotal + data.tax + data.tipAmount) !== moneyCents(data.total)
    ) {
        throw new Error(`${label} totals do not reconcile`);
    }
}

/** Strictly restores a persisted invoice without consulting mutable master data. */
export function deserializeInvoiceSnapshot(snapshot: Prisma.JsonValue): InvoiceData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Invoice snapshot is invalid');
    }
    const raw = snapshot as Record<string, Prisma.JsonValue>;
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
        throw new Error('Invoice snapshot is invalid: items');
    }
    const date = new Date(requiredString(raw.date, 'date'));
    if (Number.isNaN(date.getTime())) throw new Error('Invoice snapshot is invalid: date');

    const data: InvoiceData = {
        orderId: finiteNumber(raw.orderId, 'orderId'),
        customerName: optionalString(raw.customerName),
        customerRuc: optionalString(raw.customerRuc),
        customerTaxIdType: optionalString(raw.customerTaxIdType),
        customerFiscalAddress: optionalString(raw.customerFiscalAddress),
        customerEmail: optionalString(raw.customerEmail),
        customerPhone: optionalString(raw.customerPhone),
        items: raw.items.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Invoice snapshot is invalid: items[${index}]`);
            }
            const item = entry as Record<string, Prisma.JsonValue>;
            return {
                orderItemId: item.orderItemId == null
                    ? undefined
                    : finiteNumber(item.orderItemId, `items[${index}].orderItemId`),
                name: requiredString(item.name, `items[${index}].name`),
                quantity: finiteNumber(item.quantity, `items[${index}].quantity`),
                price: finiteNumber(item.price, `items[${index}].price`),
                subtotal: finiteNumber(item.subtotal, `items[${index}].subtotal`),
            };
        }),
        grossSubtotal: finiteNumber(raw.grossSubtotal, 'grossSubtotal'),
        discount: finiteNumber(raw.discount, 'discount'),
        subtotal: finiteNumber(raw.subtotal, 'subtotal'),
        tax: finiteNumber(raw.tax, 'tax'),
        tipAmount: finiteNumber(raw.tipAmount, 'tipAmount'),
        tipRatePercent: finiteNumber(raw.tipRatePercent, 'tipRatePercent'),
        total: finiteNumber(raw.total, 'total'),
        branchName: requiredString(raw.branchName, 'branchName'),
        branchAddress: optionalString(raw.branchAddress),
        branchPhone: optionalString(raw.branchPhone),
        companyName: requiredString(raw.companyName, 'companyName'),
        companyRuc: optionalString(raw.companyRuc),
        date,
        invoiceNumber: requiredString(raw.invoiceNumber, 'invoiceNumber'),
        taxRatePercent: finiteNumber(raw.taxRatePercent, 'taxRatePercent'),
        currencySymbol: requiredString(raw.currencySymbol, 'currencySymbol'),
    };
    assertInvoiceReconciles(data, 'Invoice snapshot');
    return data;
}

function serializeInvoiceSnapshot(data: InvoiceData): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({
        ...data,
        date: data.date.toISOString(),
    })) as Prisma.InputJsonValue;
}

function buildInvoiceData(
    order: InvoiceOrder,
    invoiceNumber: string,
    issuedAt: Date,
    settings: Record<string, string>,
): InvoiceData {
    if (order.customerTaxId) {
        validateConfiguredFiscalTaxId(order.customerTaxId, settings, 'La identificación tributaria del cliente');
    }
    const itemSubtotal = order.items.reduce(
        (sum, item, index) => sum + finiteNumber(item.subtotal, `items[${index}].subtotal`),
        0
    );
    const discount = finiteNumber(order.discount, 'discount');
    const subtotal = Math.max(0, itemSubtotal - discount);
    const tax = finiteNumber(order.tax, 'tax');
    const tipAmount = finiteNumber(order.tipAmount, 'tipAmount');
    const configuredTaxRate = Number.parseFloat(settings.tax_rate || settings.taxRate || '');
    const defaultTaxRate = Number(DEFAULT_COMPANY_SETTINGS.tax_rate);
    const configuredTipRate = Number.parseFloat(settings.tipRate || '0');

    const data: InvoiceData = {
        orderId: order.id,
        customerName: order.customerName || 'Consumidor Final',
        customerRuc: order.customerTaxId || undefined,
        customerTaxIdType: order.customerTaxIdType || undefined,
        customerFiscalAddress: order.customerFiscalAddress || undefined,
        customerEmail: order.customerEmail || undefined,
        customerPhone: order.customerPhone || undefined,
        items: order.items.map((item) => ({
            orderItemId: item.id,
            name: item.menuItem.name,
            quantity: item.quantity,
            price: finiteNumber(item.price, 'item.price'),
            subtotal: finiteNumber(item.subtotal, 'item.subtotal'),
        })),
        grossSubtotal: itemSubtotal,
        discount,
        subtotal,
        tax,
        tipAmount,
        tipRatePercent: tipAmount > 0 && subtotal > 0
            ? Math.round((tipAmount / subtotal) * 10000) / 100
            : (Number.isFinite(configuredTipRate) ? configuredTipRate : 0),
        total: finiteNumber(order.total, 'total'),
        branchName: order.branch.name,
        branchAddress: order.branch.address ?? undefined,
        branchPhone: order.branch.phone ?? undefined,
        companyName: order.branch.company.name,
        companyRuc: order.branch.company.ruc ?? undefined,
        date: issuedAt,
        invoiceNumber,
        taxRatePercent: subtotal > 0
            ? Math.round((tax / subtotal) * 10000) / 100
            : (Number.isFinite(configuredTaxRate) && configuredTaxRate >= 0
                ? configuredTaxRate
                : defaultTaxRate),
        currencySymbol: settings.currency_symbol?.trim() || DEFAULT_COMPANY_SETTINGS.currency_symbol,
    };
    assertInvoiceReconciles(data, 'Order fiscal');
    return data;
}

export class InvoiceService {
    /**
     * Issues once under an order row lock and persists the exact rendering
     * payload together with the fiscal number. Concurrent retries return the
     * first snapshot and never consume another sequence number.
     */
    static async generateInvoice(orderId: number, companyId: number): Promise<InvoiceData> {
        const settings = await SettingService.getAll(companyId);

        return prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: number }>>`
                SELECT \`id\` FROM \`Order\`
                WHERE \`id\` = ${orderId} AND \`companyId\` = ${companyId}
                FOR UPDATE`;
            if (locked.length === 0) throw new Error('Order not found or unauthorized');

            const order = await tx.order.findUnique({
                where: { id: orderId },
                include: invoiceOrderInclude,
            });
            if (!order || order.companyId !== companyId) {
                throw new Error('Order not found or unauthorized');
            }
            if (order.invoiceSnapshot !== null) {
                if (!order.invoiceNumber) throw new Error('Invoice snapshot exists without an invoice number');
                const persisted = deserializeInvoiceSnapshot(order.invoiceSnapshot);
                if (persisted.orderId !== order.id || persisted.invoiceNumber !== order.invoiceNumber) {
                    throw new Error('Invoice snapshot does not match its order');
                }
                return persisted;
            }

            // Fiscal issuance is not a pricing operation. Recomputing with the
            // current company settings would rewrite a historical/possibly paid
            // sale when tax policy changed. buildInvoiceData validates the
            // persisted line, discount, tax, tip and total snapshot and fails
            // closed if upstream pricing did not leave them reconciled.
            const totalCents = Math.round(finiteNumber(order.total, 'total') * 100);
            if (order.status === 'CANCELLED' || totalCents <= 0 || order.items.length === 0) {
                throw new Error('Solo se puede emitir una factura para una orden activa, con productos y total mayor a cero');
            }

            let invoiceNumber = order.invoiceNumber;
            const issuedAt = order.invoicedAt ?? new Date();
            if (!invoiceNumber) {
                await tx.invoiceSequence.upsert({
                    where: { companyId_branchId: { companyId, branchId: order.branchId } },
                    update: {},
                    create: { companyId, branchId: order.branchId, lastNumber: 0 },
                });
                const sequence = await tx.invoiceSequence.update({
                    where: { companyId_branchId: { companyId, branchId: order.branchId } },
                    data: { lastNumber: { increment: 1 } },
                });
                invoiceNumber = `FAC-${order.branchId}-${sequence.lastNumber.toString().padStart(6, '0')}`;
            }

            const invoiceData = buildInvoiceData(order, invoiceNumber, issuedAt, settings);
            await tx.order.update({
                where: { id: order.id },
                data: {
                    invoiceNumber,
                    invoicedAt: issuedAt,
                    invoiceSnapshot: serializeInvoiceSnapshot(invoiceData),
                    invoiceFiscalStatus: 'ISSUED',
                },
            });
            return invoiceData;
        });
    }

    /** Pure read. It never assigns a number or reconstructs mutable data. */
    static async getInvoice(orderId: number, companyId: number): Promise<InvoiceData> {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            select: { id: true, invoiceNumber: true, invoiceSnapshot: true },
        });
        if (!order) throw new Error('Order not found');
        if (!order.invoiceNumber) throw new Error('Invoice not issued');
        if (order.invoiceSnapshot === null) throw new Error('Invoice snapshot not available');

        const invoice = deserializeInvoiceSnapshot(order.invoiceSnapshot);
        if (invoice.orderId !== order.id || invoice.invoiceNumber !== order.invoiceNumber) {
            throw new Error('Invoice snapshot does not match its order');
        }
        return invoice;
    }

    static async generateInvoicePDF(orderId: number, companyId: number): Promise<Buffer> {
        const data = await this.getInvoice(orderId, companyId);
        const doc = new jsPDF();
        const margin = 15;

        doc.setFontSize(20);
        doc.text(data.companyName, margin, 20);
        doc.setFontSize(10);
        doc.text(`RUC: ${data.companyRuc || 'N/A'}`, margin, 27);
        doc.text(data.branchName, margin, 32);
        if (data.branchAddress) doc.text(data.branchAddress, margin, 37);
        if (data.branchPhone) doc.text(`Tel: ${data.branchPhone}`, margin, 42);

        doc.setFontSize(12);
        doc.text(`FACTURA: ${data.invoiceNumber}`, 140, 20);
        doc.text(`FECHA: ${data.date.toLocaleDateString()}`, 140, 27);
        doc.text(`ORDEN: #${data.orderId}`, 140, 34);
        doc.setDrawColor(200);
        doc.line(margin, 50, 195, 50);
        doc.text(`CLIENTE: ${data.customerName}`, margin, 60);
        doc.text(`${data.customerTaxIdType || 'Identificacion'}: ${data.customerRuc || 'N/A'}`, margin, 67);
        let customerY = 67;
        if (data.customerFiscalAddress) {
            customerY += 7;
            doc.text(`Direccion fiscal: ${data.customerFiscalAddress}`, margin, customerY, { maxWidth: 180 });
        }
        if (data.customerEmail || data.customerPhone) {
            customerY += 7;
            doc.text(
                [data.customerEmail ? `Correo: ${data.customerEmail}` : '', data.customerPhone ? `Tel: ${data.customerPhone}` : '']
                    .filter(Boolean)
                    .join('  |  '),
                margin,
                customerY
            );
        }
        doc.line(margin, customerY + 5, 195, customerY + 5);

        autoTable(doc, {
            head: [['Descripcion', 'Cant.', 'Precio', 'Subtotal']],
            body: data.items.map((item) => [
                item.name,
                item.quantity.toString(),
                item.price.toFixed(2),
                item.subtotal.toFixed(2),
            ]),
            startY: customerY + 12,
            margin: { left: margin, right: margin },
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            columnStyles: {
                1: { halign: 'center' },
                2: { halign: 'right' },
                3: { halign: 'right' },
            },
        });

        const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
        doc.text('Subtotal bruto:', 140, finalY);
        doc.text(data.grossSubtotal.toFixed(2), 195, finalY, { align: 'right' });
        let detailOffset = 7;
        if (data.discount > 0) {
            doc.text('Descuento:', 140, finalY + detailOffset);
            doc.text(`-${data.discount.toFixed(2)}`, 195, finalY + detailOffset, { align: 'right' });
            detailOffset += 7;
        }
        doc.text('Subtotal neto:', 140, finalY + detailOffset);
        doc.text(data.subtotal.toFixed(2), 195, finalY + detailOffset, { align: 'right' });
        detailOffset += 7;
        doc.text(`IVA (${data.taxRatePercent}%):`, 140, finalY + detailOffset);
        doc.text(data.tax.toFixed(2), 195, finalY + detailOffset, { align: 'right' });

        if (data.tipAmount > 0) {
            detailOffset += 7;
            doc.text(`Propina (${data.tipRatePercent}%):`, 140, finalY + detailOffset);
            doc.text(data.tipAmount.toFixed(2), 195, finalY + detailOffset, { align: 'right' });
        }
        detailOffset += 9;
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('TOTAL:', 140, finalY + detailOffset);
        doc.text(`${data.currencySymbol} ${data.total.toFixed(2)}`, 195, finalY + detailOffset, { align: 'right' });
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('¡Gracias por su compra!', 105, finalY + detailOffset + 14, { align: 'center' });

        return Buffer.from(doc.output('arraybuffer'));
    }
}
