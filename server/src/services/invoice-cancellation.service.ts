import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import prisma from '../utils/prisma';
import { deserializeInvoiceSnapshot, type InvoiceData } from './invoice.service';
import { OrderService } from './order.service';
import { validateConfiguredFiscalTaxId } from './setting.service';
import { transactionWithP2034Retry } from '../utils/transaction-retry';

export interface InvoiceCancellationInput {
    idempotencyKey?: unknown;
    reason?: unknown;
    wasteWarehouseId?: unknown;
}

export interface InvoiceCancellationData {
    orderId: number;
    originalInvoiceNumber: string;
    reason: string;
    jurisdiction: string;
    cancelledAt: Date;
    cancelledById: number;
    cancelledByName: string;
    wasteWarehouseId?: number;
    originalInvoice: InvoiceData;
}

function serializeSnapshot(data: InvoiceCancellationData): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({
        ...data,
        cancelledAt: data.cancelledAt.toISOString(),
        originalInvoice: { ...data.originalInvoice, date: data.originalInvoice.date.toISOString() }
    })) as Prisma.InputJsonValue;
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invoice cancellation snapshot is invalid: ${field}`);
    return value;
}

function positiveInteger(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Invoice cancellation snapshot is invalid: ${field}`);
    return number;
}

export function deserializeInvoiceCancellationSnapshot(snapshot: Prisma.JsonValue): InvoiceCancellationData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Invoice cancellation snapshot is invalid');
    }
    const raw = snapshot as Record<string, Prisma.JsonValue>;
    const cancelledAt = new Date(requiredString(raw.cancelledAt, 'cancelledAt'));
    if (Number.isNaN(cancelledAt.getTime())) throw new Error('Invoice cancellation snapshot is invalid: cancelledAt');
    const originalInvoice = deserializeInvoiceSnapshot(raw.originalInvoice);
    const result: InvoiceCancellationData = {
        orderId: positiveInteger(raw.orderId, 'orderId'),
        originalInvoiceNumber: requiredString(raw.originalInvoiceNumber, 'originalInvoiceNumber'),
        reason: requiredString(raw.reason, 'reason'),
        jurisdiction: requiredString(raw.jurisdiction, 'jurisdiction'),
        cancelledAt,
        cancelledById: positiveInteger(raw.cancelledById, 'cancelledById'),
        cancelledByName: requiredString(raw.cancelledByName, 'cancelledByName'),
        wasteWarehouseId: raw.wasteWarehouseId == null ? undefined : positiveInteger(raw.wasteWarehouseId, 'wasteWarehouseId'),
        originalInvoice
    };
    if (result.originalInvoice.invoiceNumber !== result.originalInvoiceNumber) {
        throw new Error('Invoice cancellation snapshot does not match its invoice');
    }
    return result;
}

export class InvoiceCancellationService {
    private static normalize(input: InvoiceCancellationInput) {
        const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
            throw new Error('La clave de idempotencia debe tener entre 8 y 191 caracteres');
        }
        if (reason.length < 5 || reason.length > 500) {
            throw new Error('El motivo de anulación debe tener entre 5 y 500 caracteres');
        }
        const wasteWarehouseId = input.wasteWarehouseId == null || input.wasteWarehouseId === ''
            ? undefined
            : Number(input.wasteWarehouseId);
        if (wasteWarehouseId !== undefined && (!Number.isInteger(wasteWarehouseId) || wasteWarehouseId <= 0)) {
            throw new Error('La bodega de merma no es válida');
        }
        const requestHash = createHash('sha256').update(JSON.stringify({ reason, wasteWarehouseId: wasteWarehouseId ?? null })).digest('hex');
        return { idempotencyKey, reason, wasteWarehouseId, requestHash };
    }

    static async cancel(orderId: number, companyId: number, userId: number, input: InvoiceCancellationInput) {
        if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Orden inválida');
        const normalized = this.normalize(input);
        return transactionWithP2034Retry(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: {
                    branch: { include: { company: true } },
                    payments: { where: { status: 'ACTIVE' }, select: { id: true } },
                    fiscalInvoiceCancellation: true,
                    fiscalCreditNotes: { select: { id: true }, take: 1 }
                }
            });
            if (!order) throw new Error('Order not found or unauthorized');
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true, name: true }
            });
            if (!actor) throw new Error('Invalid user for this company');

            const existingByKey = await tx.fiscalInvoiceCancellation.findUnique({
                where: { companyId_idempotencyKey: { companyId, idempotencyKey: normalized.idempotencyKey } }
            });
            const existing = order.fiscalInvoiceCancellation || existingByKey;
            if (existing) {
                if (existing.orderId !== order.id || existing.requestHash !== normalized.requestHash || existing.idempotencyKey !== normalized.idempotencyKey) {
                    throw new Error('La factura ya fue anulada o la clave de idempotencia fue reutilizada');
                }
                return deserializeInvoiceCancellationSnapshot(existing.snapshot);
            }

            if (!order.invoiceNumber || order.invoiceSnapshot === null || order.invoiceFiscalStatus !== 'ISSUED' || order.fiscalCreditNotes.length > 0) {
                throw new Error('Solo una factura emitida, íntegra y no acreditada puede anularse');
            }
            if (order.status === 'DELIVERED') {
                throw new Error('Una venta entregada no puede anularse; evalúe emitir nota de crédito');
            }
            if (order.financialStatus !== 'UNPAID' || order.payments.length > 0) {
                throw new Error('La anulación fiscal requiere una factura sin pagos activos; revierta los pagos primero');
            }
            const originalInvoice = deserializeInvoiceSnapshot(order.invoiceSnapshot);
            if (originalInvoice.orderId !== order.id || originalInvoice.invoiceNumber !== order.invoiceNumber) {
                throw new Error('Invoice snapshot does not match its order');
            }

            const jurisdictionName = `${companyId}_fiscal_jurisdiction`;
            const taxIdLengthName = `${companyId}_fiscal_tax_id_length`;
            const taxIdCharsetName = `${companyId}_fiscal_tax_id_charset`;
            await tx.$queryRaw`
                SELECT id FROM \`Setting\`
                WHERE companyId = ${companyId} AND name IN (${jurisdictionName}, ${taxIdLengthName}, ${taxIdCharsetName})
                FOR UPDATE`;
            const fiscalSettings = await tx.setting.findMany({
                where: { companyId, name: { in: [jurisdictionName, taxIdLengthName, taxIdCharsetName] } },
                select: { name: true, value: true }
            });
            const settingMap = new Map(fiscalSettings.map((setting) => [setting.name, setting.value.trim()]));
            const jurisdiction = settingMap.get(jurisdictionName) || '';
            if (!jurisdiction || jurisdiction.length > 32) {
                throw new Error('Configure explícitamente la jurisdicción fiscal antes de anular facturas');
            }
            if (!order.branch.company.ruc?.trim()) throw new Error('El RUC del emisor es obligatorio para anular la factura');
            const taxSettings = {
                fiscal_tax_id_length: settingMap.get(taxIdLengthName) || '',
                fiscal_tax_id_charset: settingMap.get(taxIdCharsetName) || ''
            };
            validateConfiguredFiscalTaxId(order.branch.company.ruc, taxSettings, 'El RUC del emisor');
            if (originalInvoice.customerRuc) {
                validateConfiguredFiscalTaxId(originalInvoice.customerRuc, taxSettings, 'La identificación tributaria del cliente');
            }

            const cancelledAt = new Date();
            const snapshot: InvoiceCancellationData = {
                orderId: order.id,
                originalInvoiceNumber: order.invoiceNumber,
                reason: normalized.reason,
                jurisdiction,
                cancelledAt,
                cancelledById: actor.id,
                cancelledByName: actor.name,
                wasteWarehouseId: normalized.wasteWarehouseId,
                originalInvoice
            };
            const cancellation = await tx.fiscalInvoiceCancellation.create({
                data: {
                    companyId,
                    branchId: order.branchId,
                    orderId: order.id,
                    originalInvoiceNumber: order.invoiceNumber,
                    reason: normalized.reason,
                    jurisdiction,
                    idempotencyKey: normalized.idempotencyKey,
                    requestHash: normalized.requestHash,
                    wasteWarehouseId: normalized.wasteWarehouseId,
                    snapshot: serializeSnapshot(snapshot),
                    cancelledAt,
                    cancelledById: actor.id
                }
            });

            await OrderService.cancelWithTransaction(
                tx,
                order.id,
                companyId,
                actor.id,
                `Anulación fiscal ${order.invoiceNumber}: ${normalized.reason}`,
                {
                    wasteWarehouseId: normalized.wasteWarehouseId,
                    fiscalInvoiceCancellationId: cancellation.id
                }
            );
            await tx.order.update({ where: { id: order.id }, data: { invoiceFiscalStatus: 'CANCELLED' } });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId: actor.id,
                    entityType: 'FiscalInvoiceCancellation',
                    entityId: cancellation.id,
                    action: 'CANCEL',
                    details: {
                        originalInvoiceNumber: order.invoiceNumber,
                        orderId: order.id,
                        cancelledAt: cancelledAt.toISOString(),
                        reason: normalized.reason,
                        wasteWarehouseId: normalized.wasteWarehouseId || null
                    }
                }
            });
            return snapshot;
        });
    }

    static async getByOrder(orderId: number, companyId: number) {
        const cancellation = await prisma.fiscalInvoiceCancellation.findFirst({
            where: { orderId, companyId },
            select: { orderId: true, originalInvoiceNumber: true, snapshot: true }
        });
        if (!cancellation) throw new Error('Invoice cancellation not issued');
        const snapshot = deserializeInvoiceCancellationSnapshot(cancellation.snapshot);
        if (snapshot.orderId !== cancellation.orderId || snapshot.originalInvoiceNumber !== cancellation.originalInvoiceNumber) {
            throw new Error('Invoice cancellation snapshot does not match its document');
        }
        return snapshot;
    }

    static async list(companyId: number, filters: { branchId?: number; startDate?: Date; endDate?: Date } = {}) {
        return prisma.fiscalInvoiceCancellation.findMany({
            where: {
                companyId,
                ...(filters.branchId ? { branchId: filters.branchId } : {}),
                ...(filters.startDate || filters.endDate ? {
                    cancelledAt: { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) }
                } : {})
            },
            select: { id: true, orderId: true, branchId: true, originalInvoiceNumber: true, reason: true, cancelledAt: true, cancelledBy: { select: { id: true, name: true } } },
            orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }]
        });
    }

    static async generatePDF(orderId: number, companyId: number): Promise<Buffer> {
        const data = await this.getByOrder(orderId, companyId);
        const invoice = data.originalInvoice;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(invoice.companyName, 15, 20);
        doc.setFontSize(10);
        doc.text(`RUC: ${invoice.companyRuc || 'N/A'}`, 15, 27);
        doc.setFontSize(15);
        doc.text('CONSTANCIA DE ANULACION DE FACTURA', 105, 45, { align: 'center' });
        doc.setFontSize(11);
        doc.text(`Factura: ${data.originalInvoiceNumber}`, 15, 62);
        doc.text(`Fecha original: ${invoice.date.toLocaleDateString('es-NI')}`, 15, 70);
        doc.text(`Fecha de anulacion: ${data.cancelledAt.toLocaleDateString('es-NI')}`, 15, 78);
        doc.text(`Jurisdiccion configurada: ${data.jurisdiction}`, 15, 86);
        doc.text(`Cliente: ${invoice.customerName || 'Consumidor Final'}`, 15, 94);
        doc.text(`Motivo: ${data.reason}`, 15, 106, { maxWidth: 180 });
        doc.text(`Total preservado en documento anulado: ${invoice.currencySymbol} ${invoice.total.toFixed(2)}`, 15, 126);
        doc.text(`Anulada por: ${data.cancelledByName}`, 15, 138);
        doc.setFontSize(9);
        doc.text('El número original se conserva para trazabilidad; esta constancia no asigna una nueva serie fiscal.', 15, 154, { maxWidth: 180 });
        return Buffer.from(doc.output('arraybuffer'));
    }
}
