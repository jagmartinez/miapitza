import { createHash } from 'crypto';
import type { CreditNoteInventoryDisposition, PaymentMethodType, Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import prisma from '../utils/prisma';
import { deserializeInvoiceSnapshot, type InvoiceData } from './invoice.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { OrderService } from './order.service';
import { validateConfiguredFiscalTaxId } from './setting.service';

export interface CreditNoteIssueInput {
    idempotencyKey?: unknown;
    reason?: unknown;
    inventoryAction?: unknown;
    wasteWarehouseId?: unknown;
    externalRefunds?: Array<{ paymentId?: unknown; reference?: unknown }>;
}

export interface CreditNoteData {
    orderId: number;
    creditNoteNumber: string;
    series: string;
    sequenceNumber: number;
    status: 'ISSUED';
    originalInvoiceNumber: string;
    reason: string;
    jurisdiction: string;
    issuedAt: Date;
    issuedById: number;
    issuedByName: string;
    inventoryDisposition: CreditNoteInventoryDisposition;
    wasteWarehouseId?: number;
    refunds: Array<{
        paymentId: number;
        methodType: PaymentMethodType;
        amount: number;
        reference: string;
    }>;
    originalInvoice: InvoiceData;
}

interface NormalizedIssueInput {
    idempotencyKey: string;
    reason: string;
    inventoryAction: 'NO_RETURN' | 'RETURN_TO_STOCK';
    wasteWarehouseId?: number;
    externalRefunds: Array<{ paymentId: number; reference: string }>;
    requestHash: string;
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Credit note snapshot is invalid: ${field}`);
    return value;
}

function positiveInteger(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Credit note snapshot is invalid: ${field}`);
    return number;
}

function serializeSnapshot(data: CreditNoteData): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({
        ...data,
        issuedAt: data.issuedAt.toISOString(),
        originalInvoice: { ...data.originalInvoice, date: data.originalInvoice.date.toISOString() }
    })) as Prisma.InputJsonValue;
}

export function deserializeCreditNoteSnapshot(snapshot: Prisma.JsonValue): CreditNoteData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Credit note snapshot is invalid');
    }
    const raw = snapshot as Record<string, Prisma.JsonValue>;
    const issuedAt = new Date(requiredString(raw.issuedAt, 'issuedAt'));
    if (Number.isNaN(issuedAt.getTime())) throw new Error('Credit note snapshot is invalid: issuedAt');
    const disposition = requiredString(raw.inventoryDisposition, 'inventoryDisposition');
    if (!['NOT_CONSUMED', 'NOT_RETURNED', 'RETURNED_TO_ORIGINAL_STOCK'].includes(disposition)) {
        throw new Error('Credit note snapshot is invalid: inventoryDisposition');
    }
    if (!Array.isArray(raw.refunds)) throw new Error('Credit note snapshot is invalid: refunds');
    const originalInvoice = deserializeInvoiceSnapshot(raw.originalInvoice);
    const data: CreditNoteData = {
        orderId: positiveInteger(raw.orderId, 'orderId'),
        creditNoteNumber: requiredString(raw.creditNoteNumber, 'creditNoteNumber'),
        series: requiredString(raw.series, 'series'),
        sequenceNumber: positiveInteger(raw.sequenceNumber, 'sequenceNumber'),
        status: requiredString(raw.status, 'status') as 'ISSUED',
        originalInvoiceNumber: requiredString(raw.originalInvoiceNumber, 'originalInvoiceNumber'),
        reason: requiredString(raw.reason, 'reason'),
        jurisdiction: requiredString(raw.jurisdiction, 'jurisdiction'),
        issuedAt,
        issuedById: positiveInteger(raw.issuedById, 'issuedById'),
        issuedByName: requiredString(raw.issuedByName, 'issuedByName'),
        inventoryDisposition: disposition as CreditNoteInventoryDisposition,
        wasteWarehouseId: raw.wasteWarehouseId == null ? undefined : positiveInteger(raw.wasteWarehouseId, 'wasteWarehouseId'),
        refunds: raw.refunds.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Credit note snapshot is invalid: refunds[${index}]`);
            }
            const refund = entry as Record<string, Prisma.JsonValue>;
            const methodType = requiredString(refund.methodType, `refunds[${index}].methodType`);
            if (!['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'].includes(methodType)) {
                throw new Error(`Credit note snapshot is invalid: refunds[${index}].methodType`);
            }
            const amount = Number(refund.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error(`Credit note snapshot is invalid: refunds[${index}].amount`);
            }
            return {
                paymentId: positiveInteger(refund.paymentId, `refunds[${index}].paymentId`),
                methodType: methodType as PaymentMethodType,
                amount,
                reference: requiredString(refund.reference, `refunds[${index}].reference`)
            };
        }),
        originalInvoice
    };
    if (data.status !== 'ISSUED' || data.originalInvoice.invoiceNumber !== data.originalInvoiceNumber) {
        throw new Error('Credit note snapshot does not match its original invoice');
    }
    return data;
}

export class CreditNoteService {
    private static normalizeInput(input: CreditNoteIssueInput): NormalizedIssueInput {
        const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
            throw new Error('La clave de idempotencia debe tener entre 8 y 191 caracteres');
        }
        if (reason.length < 5 || reason.length > 500) {
            throw new Error('El motivo de la nota de crédito debe tener entre 5 y 500 caracteres');
        }
        if (input.inventoryAction !== 'NO_RETURN' && input.inventoryAction !== 'RETURN_TO_STOCK') {
            throw new Error('Debe indicar si la mercadería fue devuelta físicamente');
        }
        const wasteWarehouseId = input.wasteWarehouseId == null || input.wasteWarehouseId === ''
            ? undefined
            : Number(input.wasteWarehouseId);
        if (wasteWarehouseId !== undefined && (!Number.isInteger(wasteWarehouseId) || wasteWarehouseId <= 0)) {
            throw new Error('La bodega de merma no es válida');
        }
        const externalRefunds = (input.externalRefunds || []).map((entry) => {
            const paymentId = Number(entry.paymentId);
            const reference = typeof entry.reference === 'string' ? entry.reference.trim() : '';
            if (!Number.isInteger(paymentId) || paymentId <= 0 || !reference || reference.length > 191) {
                throw new Error('Cada reembolso externo requiere pago y referencia verificable');
            }
            return { paymentId, reference };
        }).sort((a, b) => a.paymentId - b.paymentId);
        if (new Set(externalRefunds.map((entry) => entry.paymentId)).size !== externalRefunds.length) {
            throw new Error('No se puede repetir un pago en las referencias de reembolso');
        }
        const requestHash = createHash('sha256').update(JSON.stringify({
            reason,
            inventoryAction: input.inventoryAction,
            wasteWarehouseId: wasteWarehouseId ?? null,
            externalRefunds
        })).digest('hex');
        return {
            idempotencyKey,
            reason,
            inventoryAction: input.inventoryAction,
            wasteWarehouseId,
            externalRefunds,
            requestHash
        };
    }

    static async issue(orderId: number, companyId: number, userId: number, input: CreditNoteIssueInput) {
        if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Orden inválida');
        const normalized = this.normalizeInput(input);

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: {
                    branch: { include: { company: true } },
                    payments: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } },
                    fiscalCreditNote: true,
                    items: { include: { menuItem: { include: { recipes: { select: { id: true } } } } } }
                }
            });
            if (!order) throw new Error('Order not found or unauthorized');

            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true, name: true }
            });
            if (!actor) throw new Error('Invalid user for this company');

            const existingByKey = await tx.fiscalCreditNote.findUnique({
                where: { companyId_idempotencyKey: { companyId, idempotencyKey: normalized.idempotencyKey } }
            });
            const existing = order.fiscalCreditNote || existingByKey;
            if (existing) {
                if (existing.orderId !== order.id || existing.requestHash !== normalized.requestHash || existing.idempotencyKey !== normalized.idempotencyKey) {
                    throw new Error('La factura ya tiene otra nota de crédito o la clave de idempotencia fue reutilizada');
                }
                return deserializeCreditNoteSnapshot(existing.snapshot);
            }

            if (!order.invoiceNumber || order.invoiceSnapshot === null || order.invoiceFiscalStatus !== 'ISSUED') {
                throw new Error('Solo una factura emitida e íntegra puede recibir nota de crédito');
            }
            const originalInvoice = deserializeInvoiceSnapshot(order.invoiceSnapshot);
            if (originalInvoice.orderId !== order.id || originalInvoice.invoiceNumber !== order.invoiceNumber) {
                throw new Error('Invoice snapshot does not match its order');
            }

            const jurisdictionName = `${companyId}_fiscal_jurisdiction`;
            const seriesName = `${companyId}_credit_note_series`;
            const taxIdLengthName = `${companyId}_fiscal_tax_id_length`;
            const taxIdCharsetName = `${companyId}_fiscal_tax_id_charset`;
            await tx.$queryRaw`
                SELECT id FROM \`Setting\`
                WHERE companyId = ${companyId} AND name IN (${jurisdictionName}, ${seriesName}, ${taxIdLengthName}, ${taxIdCharsetName})
                FOR UPDATE`;
            const fiscalSettings = await tx.setting.findMany({
                where: { companyId, name: { in: [jurisdictionName, seriesName, taxIdLengthName, taxIdCharsetName] } },
                select: { name: true, value: true }
            });
            const settingMap = new Map(fiscalSettings.map((setting) => [setting.name, setting.value.trim()]));
            const jurisdiction = settingMap.get(jurisdictionName) || '';
            const series = settingMap.get(seriesName) || '';
            if (!jurisdiction || jurisdiction.length > 32) {
                throw new Error('Configure explícitamente la jurisdicción fiscal antes de emitir notas de crédito');
            }
            if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(series)) {
                throw new Error('Configure una serie de nota de crédito válida (A-Z, 0-9 y guion; máximo 20)');
            }
            if (!order.branch.company.ruc?.trim()) {
                throw new Error('El RUC del emisor es obligatorio para emitir la nota de crédito');
            }
            const taxSettings = {
                fiscal_tax_id_length: settingMap.get(taxIdLengthName) || '',
                fiscal_tax_id_charset: settingMap.get(taxIdCharsetName) || ''
            };
            validateConfiguredFiscalTaxId(order.branch.company.ruc, taxSettings, 'El RUC del emisor');
            if (originalInvoice.customerRuc) {
                validateConfiguredFiscalTaxId(originalInvoice.customerRuc, taxSettings, 'La identificación tributaria del cliente');
            }

            if (order.status !== 'DELIVERED' || order.financialStatus !== 'PAID') {
                throw new Error('La nota de crédito se reserva para ventas entregadas y liquidadas; use anulación para una factura previa a entrega');
            }
            const activePaidCents = order.payments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
            if (activePaidCents !== Math.round(originalInvoice.total * 100)) {
                throw new Error('Los pagos activos no concilian con la factura; requiere remediación antes de acreditar');
            }
            if (normalized.wasteWarehouseId !== undefined) {
                throw new Error('Una nota de crédito post-entrega no acepta bodega de merma');
            }
            const inventoryDisposition: CreditNoteInventoryDisposition = normalized.inventoryAction === 'RETURN_TO_STOCK'
                ? 'RETURNED_TO_ORIGINAL_STOCK'
                : 'NOT_RETURNED';

            const nonCashPayments = order.payments.filter((payment) => payment.methodType !== 'CASH');
            const refundMap = new Map(normalized.externalRefunds.map((entry) => [entry.paymentId, entry.reference]));
            for (const payment of nonCashPayments) {
                if (!refundMap.get(payment.id)) {
                    throw new Error(`Registre la referencia del reembolso externo para el pago #${payment.id}`);
                }
            }
            if ([...refundMap.keys()].some((paymentId) => !nonCashPayments.some((payment) => payment.id === paymentId))) {
                throw new Error('Se recibió una referencia para un pago que no está activo o es efectivo');
            }

            await tx.creditNoteSequence.upsert({
                where: { companyId_series: { companyId, series } },
                update: {},
                create: { companyId, series, lastNumber: 0 }
            });
            const sequence = await tx.creditNoteSequence.update({
                where: { companyId_series: { companyId, series } },
                data: { lastNumber: { increment: 1 } }
            });
            const number = `${series}-${sequence.lastNumber.toString().padStart(8, '0')}`;
            const issuedAt = new Date();
            const refunds = order.payments.map((payment) => ({
                paymentId: payment.id,
                methodType: payment.methodType,
                amount: Number(payment.amount),
                reference: payment.methodType === 'CASH' ? `REV-PAY-${payment.id}` : refundMap.get(payment.id)!
            }));
            const snapshot: CreditNoteData = {
                orderId: order.id,
                creditNoteNumber: number,
                series,
                sequenceNumber: sequence.lastNumber,
                status: 'ISSUED',
                originalInvoiceNumber: order.invoiceNumber,
                reason: normalized.reason,
                jurisdiction,
                issuedAt,
                issuedById: actor.id,
                issuedByName: actor.name,
                inventoryDisposition,
                wasteWarehouseId: normalized.wasteWarehouseId,
                refunds,
                originalInvoice
            };

            const creditNote = await tx.fiscalCreditNote.create({
                data: {
                    companyId,
                    branchId: order.branchId,
                    orderId: order.id,
                    number,
                    series,
                    sequenceNumber: sequence.lastNumber,
                    status: 'ISSUED',
                    originalInvoiceNumber: order.invoiceNumber,
                    reason: normalized.reason,
                    jurisdiction,
                    idempotencyKey: normalized.idempotencyKey,
                    requestHash: normalized.requestHash,
                    subtotal: originalInvoice.subtotal,
                    tax: originalInvoice.tax,
                    tipAmount: originalInvoice.tipAmount,
                    total: originalInvoice.total,
                    inventoryDisposition,
                    wasteWarehouseId: normalized.wasteWarehouseId,
                    snapshot: serializeSnapshot(snapshot),
                    issuedAt,
                    issuedById: actor.id
                }
            });

            await OrderService.cancelWithTransaction(
                tx,
                order.id,
                companyId,
                actor.id,
                `Nota de crédito ${number}: ${normalized.reason}`,
                {
                    allowPaidReversal: true,
                    wasteWarehouseId: normalized.wasteWarehouseId,
                    fiscalCreditNoteId: creditNote.id,
                    externalRefundReferences: normalized.externalRefunds
                }
            );

            if (inventoryDisposition === 'RETURNED_TO_ORIGINAL_STOCK') {
                const reversed = await InventoryConsumptionService.reverseForOrder(tx, {
                    orderId: order.id,
                    userId: actor.id,
                    companyId,
                    reason: `Devolución física respaldada por nota de crédito ${number}`,
                    sourceType: 'ADJUSTMENT',
                    reversalOrigin: `FISCAL_CREDIT_NOTE:${creditNote.id}`
                });
                const inventoryBearingItems = order.items.some((item) => item.menuItem.recipes.length > 0);
                if (inventoryBearingItems && !reversed.reversed) {
                    throw new Error('La orden entregada no tiene consumo íntegro que pueda devolverse; requiere remediación de inventario');
                }
            }

            await tx.order.update({
                where: { id: order.id },
                data: { invoiceFiscalStatus: 'CREDITED' }
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId: actor.id,
                    entityType: 'FiscalCreditNote',
                    entityId: creditNote.id,
                    action: 'ISSUE',
                    details: {
                        number,
                        originalInvoiceNumber: order.invoiceNumber,
                        orderId: order.id,
                        reason: normalized.reason,
                        inventoryDisposition,
                        refundedPaymentIds: order.payments.map((payment) => payment.id),
                        total: originalInvoice.total
                    }
                }
            });
            return snapshot;
        });
    }

    static async getByOrder(orderId: number, companyId: number): Promise<CreditNoteData> {
        const creditNote = await prisma.fiscalCreditNote.findFirst({
            where: { orderId, companyId },
            select: { orderId: true, number: true, snapshot: true }
        });
        if (!creditNote) throw new Error('Credit note not issued');
        const snapshot = deserializeCreditNoteSnapshot(creditNote.snapshot);
        if (snapshot.orderId !== creditNote.orderId || snapshot.creditNoteNumber !== creditNote.number) {
            throw new Error('Credit note snapshot does not match its document');
        }
        return snapshot;
    }

    static async list(companyId: number, filters: { branchId?: number; startDate?: Date; endDate?: Date } = {}) {
        const rows = await prisma.fiscalCreditNote.findMany({
            where: {
                companyId,
                ...(filters.branchId ? { branchId: filters.branchId } : {}),
                ...(filters.startDate || filters.endDate ? {
                    issuedAt: { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) }
                } : {})
            },
            select: { id: true, orderId: true, branchId: true, number: true, originalInvoiceNumber: true, reason: true, total: true, issuedAt: true, issuedBy: { select: { id: true, name: true } } },
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }]
        });
        return rows;
    }

    static async generatePDF(orderId: number, companyId: number): Promise<Buffer> {
        const data = await this.getByOrder(orderId, companyId);
        const invoice = data.originalInvoice;
        const doc = new jsPDF();
        const margin = 15;
        doc.setFontSize(18);
        doc.text(invoice.companyName, margin, 18);
        doc.setFontSize(10);
        doc.text(`RUC: ${invoice.companyRuc || 'N/A'}`, margin, 25);
        doc.text(invoice.branchName, margin, 31);
        doc.setFontSize(14);
        doc.text('NOTA DE CREDITO', 195, 18, { align: 'right' });
        doc.setFontSize(10);
        doc.text(`Numero: ${data.creditNoteNumber}`, 195, 25, { align: 'right' });
        doc.text(`Factura afectada: ${data.originalInvoiceNumber}`, 195, 31, { align: 'right' });
        doc.text(`Fecha: ${data.issuedAt.toLocaleDateString('es-NI')}`, 195, 37, { align: 'right' });
        doc.text(`Jurisdiccion configurada: ${data.jurisdiction}`, margin, 43);
        doc.text(`Cliente: ${invoice.customerName || 'Consumidor Final'}`, margin, 50);
        doc.text(`${invoice.customerTaxIdType || 'Identificacion'}: ${invoice.customerRuc || 'N/A'}`, margin, 57);
        doc.text(`Motivo: ${data.reason}`, margin, 66, { maxWidth: 180 });

        autoTable(doc, {
            head: [['Descripcion', 'Cant.', 'Precio', 'Importe acreditado']],
            body: invoice.items.map((item) => [item.name, item.quantity.toString(), item.price.toFixed(2), item.subtotal.toFixed(2)]),
            startY: 78,
            margin: { left: margin, right: margin },
            theme: 'striped',
            headStyles: { fillColor: [153, 27, 27], textColor: 255 },
            columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });
        const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
        doc.text('Subtotal neto:', 140, finalY);
        doc.text(invoice.subtotal.toFixed(2), 195, finalY, { align: 'right' });
        doc.text(`Impuesto (${invoice.taxRatePercent}%):`, 140, finalY + 7);
        doc.text(invoice.tax.toFixed(2), 195, finalY + 7, { align: 'right' });
        if (invoice.tipAmount > 0) {
            doc.text('Propina:', 140, finalY + 14);
            doc.text(invoice.tipAmount.toFixed(2), 195, finalY + 14, { align: 'right' });
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('TOTAL ACREDITADO:', 120, finalY + 24);
        doc.text(`${invoice.currencySymbol} ${invoice.total.toFixed(2)}`, 195, finalY + 24, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Tratamiento de inventario: ${data.inventoryDisposition}`, margin, finalY + 38);
        doc.text(`Emitida por: ${data.issuedByName}`, margin, finalY + 45);
        return Buffer.from(doc.output('arraybuffer'));
    }
}
