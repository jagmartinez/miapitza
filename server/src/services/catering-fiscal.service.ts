import { createHash } from 'crypto';
import type { CreditNoteInventoryDisposition, PaymentMethodType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { InventoryEngineService, type BatchSourceType } from './inventory-engine.service';
import { DEFAULT_COMPANY_SETTINGS, SettingService, validateConfiguredFiscalTaxId } from './setting.service';
import { CateringService } from './catering.service';
import { CostingService } from './costing.service';

type JsonRecord = Record<string, Prisma.JsonValue>;

export interface CateringFiscalLine {
    kind: 'SERVICE' | 'MENU_ITEM';
    sourceId: number;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}

export interface CateringInvoiceData {
    eventId: number;
    invoiceNumber: string;
    status: 'ISSUED';
    eventTitle: string;
    eventDate: Date;
    customerName: string;
    customerTaxId?: string;
    customerPhone?: string;
    companyName: string;
    companyRuc?: string;
    branchName: string;
    branchAddress?: string;
    currencySymbol: string;
    lines: CateringFiscalLine[];
    subtotal: number;
    tax: number;
    taxRatePercent: number;
    total: number;
    payments: Array<{
        paymentId: number;
        methodType: PaymentMethodType;
        amount: number;
        reference?: string;
    }>;
    issuedAt: Date;
    issuedById: number;
    issuedByName: string;
}

export interface CateringCreditNoteData {
    eventId: number;
    creditNoteNumber: string;
    originalInvoiceNumber: string;
    status: 'ISSUED';
    reason: string;
    jurisdiction: string;
    inventoryDisposition: CreditNoteInventoryDisposition;
    refunds: Array<{
        paymentId: number;
        methodType: PaymentMethodType;
        amount: number;
        reference: string;
    }>;
    issuedAt: Date;
    issuedById: number;
    issuedByName: string;
    originalInvoice: CateringInvoiceData;
}

export interface CateringCreditNoteInput {
    idempotencyKey?: unknown;
    reason?: unknown;
    inventoryAction?: unknown;
    externalRefunds?: Array<{ paymentId?: unknown; reference?: unknown }>;
}

function cents(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Catering fiscal snapshot is invalid: ${field}`);
    return Math.round(parsed * 100);
}

function positiveInteger(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Catering fiscal snapshot is invalid: ${field}`);
    return parsed;
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Catering fiscal snapshot is invalid: ${field}`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function serialize(value: CateringInvoiceData | CateringCreditNoteData): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertInvoiceReconciles(data: CateringInvoiceData): void {
    if (data.lines.length === 0) throw new Error('Catering fiscal totals do not reconcile');
    const lineCents = data.lines.reduce((sum, line) => {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
            throw new Error('Catering fiscal totals do not reconcile');
        }
        if (Math.round(line.quantity * line.unitPrice * 100) !== cents(line.subtotal, 'line.subtotal')) {
            throw new Error('Catering fiscal totals do not reconcile');
        }
        return sum + cents(line.subtotal, 'line.subtotal');
    }, 0);
    const subtotalCents = cents(data.subtotal, 'subtotal');
    const taxCents = cents(data.tax, 'tax');
    const totalCents = cents(data.total, 'total');
    const paidCents = data.payments.reduce((sum, payment) => sum + cents(payment.amount, 'payment.amount'), 0);
    if (lineCents !== totalCents || subtotalCents + taxCents !== totalCents || paidCents !== totalCents || totalCents <= 0) {
        throw new Error('Catering fiscal totals do not reconcile');
    }
}

export function deserializeCateringInvoiceSnapshot(snapshot: Prisma.JsonValue): CateringInvoiceData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Catering fiscal snapshot is invalid');
    }
    const raw = snapshot as JsonRecord;
    if (!Array.isArray(raw.lines) || !Array.isArray(raw.payments)) {
        throw new Error('Catering fiscal snapshot is invalid: collections');
    }
    const eventDate = new Date(requiredString(raw.eventDate, 'eventDate'));
    const issuedAt = new Date(requiredString(raw.issuedAt, 'issuedAt'));
    if (Number.isNaN(eventDate.getTime()) || Number.isNaN(issuedAt.getTime())) {
        throw new Error('Catering fiscal snapshot is invalid: dates');
    }
    const data: CateringInvoiceData = {
        eventId: positiveInteger(raw.eventId, 'eventId'),
        invoiceNumber: requiredString(raw.invoiceNumber, 'invoiceNumber'),
        status: requiredString(raw.status, 'status') as 'ISSUED',
        eventTitle: requiredString(raw.eventTitle, 'eventTitle'),
        eventDate,
        customerName: requiredString(raw.customerName, 'customerName'),
        customerTaxId: optionalString(raw.customerTaxId),
        customerPhone: optionalString(raw.customerPhone),
        companyName: requiredString(raw.companyName, 'companyName'),
        companyRuc: optionalString(raw.companyRuc),
        branchName: requiredString(raw.branchName, 'branchName'),
        branchAddress: optionalString(raw.branchAddress),
        currencySymbol: requiredString(raw.currencySymbol, 'currencySymbol'),
        lines: raw.lines.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Catering fiscal snapshot is invalid: lines[${index}]`);
            }
            const line = entry as JsonRecord;
            const kind = requiredString(line.kind, `lines[${index}].kind`);
            if (kind !== 'SERVICE' && kind !== 'MENU_ITEM') throw new Error(`Catering fiscal snapshot is invalid: lines[${index}].kind`);
            return {
                kind,
                sourceId: positiveInteger(line.sourceId, `lines[${index}].sourceId`),
                name: requiredString(line.name, `lines[${index}].name`),
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice),
                subtotal: Number(line.subtotal),
            };
        }),
        subtotal: Number(raw.subtotal),
        tax: Number(raw.tax),
        taxRatePercent: Number(raw.taxRatePercent),
        total: Number(raw.total),
        payments: raw.payments.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Catering fiscal snapshot is invalid: payments[${index}]`);
            }
            const payment = entry as JsonRecord;
            const methodType = requiredString(payment.methodType, `payments[${index}].methodType`) as PaymentMethodType;
            if (!['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'].includes(methodType)) {
                throw new Error(`Catering fiscal snapshot is invalid: payments[${index}].methodType`);
            }
            return {
                paymentId: positiveInteger(payment.paymentId, `payments[${index}].paymentId`),
                methodType,
                amount: Number(payment.amount),
                reference: optionalString(payment.reference),
            };
        }),
        issuedAt,
        issuedById: positiveInteger(raw.issuedById, 'issuedById'),
        issuedByName: requiredString(raw.issuedByName, 'issuedByName'),
    };
    if (data.status !== 'ISSUED') throw new Error('Catering fiscal snapshot is invalid: status');
    assertInvoiceReconciles(data);
    return data;
}

export function deserializeCateringCreditNoteSnapshot(snapshot: Prisma.JsonValue): CateringCreditNoteData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Catering credit note snapshot is invalid');
    }
    const raw = snapshot as JsonRecord;
    if (!Array.isArray(raw.refunds) || !raw.originalInvoice || typeof raw.originalInvoice !== 'object' || Array.isArray(raw.originalInvoice)) {
        throw new Error('Catering credit note snapshot is invalid: collections');
    }
    const issuedAt = new Date(requiredString(raw.issuedAt, 'issuedAt'));
    if (Number.isNaN(issuedAt.getTime())) throw new Error('Catering credit note snapshot is invalid: issuedAt');
    const disposition = requiredString(raw.inventoryDisposition, 'inventoryDisposition') as CreditNoteInventoryDisposition;
    if (!['NOT_CONSUMED', 'NOT_RETURNED', 'RETURNED_TO_ORIGINAL_STOCK'].includes(disposition)) {
        throw new Error('Catering credit note snapshot is invalid: inventoryDisposition');
    }
    const data: CateringCreditNoteData = {
        eventId: positiveInteger(raw.eventId, 'eventId'),
        creditNoteNumber: requiredString(raw.creditNoteNumber, 'creditNoteNumber'),
        originalInvoiceNumber: requiredString(raw.originalInvoiceNumber, 'originalInvoiceNumber'),
        status: requiredString(raw.status, 'status') as 'ISSUED',
        reason: requiredString(raw.reason, 'reason'),
        jurisdiction: requiredString(raw.jurisdiction, 'jurisdiction'),
        inventoryDisposition: disposition,
        refunds: raw.refunds.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Catering credit note snapshot is invalid: refunds[${index}]`);
            }
            const refund = entry as JsonRecord;
            return {
                paymentId: positiveInteger(refund.paymentId, `refunds[${index}].paymentId`),
                methodType: requiredString(refund.methodType, `refunds[${index}].methodType`) as PaymentMethodType,
                amount: Number(refund.amount),
                reference: requiredString(refund.reference, `refunds[${index}].reference`),
            };
        }),
        issuedAt,
        issuedById: positiveInteger(raw.issuedById, 'issuedById'),
        issuedByName: requiredString(raw.issuedByName, 'issuedByName'),
        originalInvoice: deserializeCateringInvoiceSnapshot(raw.originalInvoice),
    };
    if (data.status !== 'ISSUED' || data.originalInvoice.invoiceNumber !== data.originalInvoiceNumber || data.originalInvoice.eventId !== data.eventId) {
        throw new Error('Catering credit note snapshot does not match its invoice');
    }
    const refundedCents = data.refunds.reduce((sum, refund) => sum + cents(refund.amount, 'refund.amount'), 0);
    if (refundedCents !== cents(data.originalInvoice.total, 'invoice.total')) {
        throw new Error('Catering credit note refunds do not reconcile');
    }
    return data;
}

function normalizeIdempotencyKey(value: unknown): string {
    const key = typeof value === 'string' ? value.trim() : '';
    if (key.length < 8 || key.length > 191) throw new Error('La clave de idempotencia debe tener entre 8 y 191 caracteres');
    return key;
}

export class CateringFiscalService {
    static async issueInvoice(eventId: number, companyId: number, userId: number, idempotencyKeyInput: unknown) {
        const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);
        const requestHash = createHash('sha256').update(JSON.stringify({ eventId })).digest('hex');
        const settings = await SettingService.getAll(companyId);

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${eventId} AND companyId = ${companyId} FOR UPDATE`;
            const event = await tx.cateringEvent.findFirst({
                where: { id: eventId, companyId },
                include: {
                    company: true,
                    branch: true,
                    customer: true,
                    services: { include: { service: true }, orderBy: { id: 'asc' } },
                    menuItems: { include: { menuItem: true }, orderBy: { id: 'asc' } },
                    payments: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } },
                    fiscalInvoice: true,
                },
            });
            if (!event) throw new Error('Catering event not found');
            const actor = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true, name: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');

            const existingByKey = await tx.cateringFiscalInvoice.findUnique({
                where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
            });
            const existing = event.fiscalInvoice || existingByKey;
            if (existing) {
                if (existing.cateringEventId !== eventId || existing.idempotencyKey !== idempotencyKey || existing.requestHash !== requestHash) {
                    throw new Error('La factura de catering ya fue emitida o la clave de idempotencia fue reutilizada');
                }
                return deserializeCateringInvoiceSnapshot(existing.snapshot);
            }
            if (event.status !== 'PAID' && event.status !== 'FINISHED') {
                throw new Error('Solo un evento pagado o finalizado puede facturarse');
            }
            if (!event.company.ruc?.trim()) throw new Error('El RUC del emisor es obligatorio para emitir la factura de catering');
            validateConfiguredFiscalTaxId(event.company.ruc, settings, 'El RUC del emisor');
            if (event.customer?.taxId) validateConfiguredFiscalTaxId(event.customer.taxId, settings, 'La identificación tributaria del cliente');

            const lines: CateringFiscalLine[] = [
                ...event.services.map((line) => ({
                    kind: 'SERVICE' as const,
                    sourceId: line.cateringServiceId,
                    name: line.service.name,
                    quantity: Number(line.quantity),
                    unitPrice: Number(line.unitPrice),
                    subtotal: Number(line.subtotal),
                })),
                ...event.menuItems.map((line) => ({
                    kind: 'MENU_ITEM' as const,
                    sourceId: line.menuItemId,
                    name: line.menuItem.name,
                    quantity: line.quantity,
                    unitPrice: Number(line.unitPrice),
                    subtotal: Number(line.subtotal),
                })),
            ];
            const grossLineTotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
            const total = Number(event.totalAmount);
            if (
                event.fiscalSubtotal == null
                || event.fiscalTax == null
                || event.fiscalTaxRatePercent == null
                || event.pricingSnapshotCapturedAt == null
            ) {
                throw new Error('El evento legacy no conserva una descomposición fiscal histórica; requiere remediación antes de facturar');
            }
            const subtotal = Number(event.fiscalSubtotal);
            const tax = Number(event.fiscalTax);
            const taxRatePercent = Number(event.fiscalTaxRatePercent);
            if (
                cents(grossLineTotal, 'grossLineTotal') !== cents(total, 'total')
                || cents(subtotal, 'subtotal') + cents(tax, 'tax') !== cents(total, 'total')
                || !Number.isFinite(taxRatePercent)
                || taxRatePercent < 0
            ) {
                throw new Error('Catering fiscal totals do not reconcile');
            }

            await tx.invoiceSequence.upsert({
                where: { companyId_branchId: { companyId, branchId: event.branchId } },
                update: {},
                create: { companyId, branchId: event.branchId, lastNumber: 0 },
            });
            const sequence = await tx.invoiceSequence.update({
                where: { companyId_branchId: { companyId, branchId: event.branchId } },
                data: { lastNumber: { increment: 1 } },
            });
            const invoiceNumber = `FAC-${event.branchId}-${sequence.lastNumber.toString().padStart(6, '0')}`;
            const issuedAt = new Date();
            const snapshot: CateringInvoiceData = {
                eventId,
                invoiceNumber,
                status: 'ISSUED',
                eventTitle: event.title,
                eventDate: event.date,
                customerName: event.customer?.name || 'Consumidor Final',
                customerTaxId: event.customer?.taxId || undefined,
                customerPhone: event.customer?.phone || undefined,
                companyName: event.company.name,
                companyRuc: event.company.ruc || undefined,
                branchName: event.branch.name,
                branchAddress: event.branch.address || undefined,
                currencySymbol: settings.currency_symbol?.trim() || DEFAULT_COMPANY_SETTINGS.currency_symbol,
                lines,
                subtotal,
                tax,
                taxRatePercent,
                total,
                payments: event.payments.map((payment) => ({
                    paymentId: payment.id,
                    methodType: payment.methodType,
                    amount: Number(payment.amount),
                    reference: payment.reference || undefined,
                })),
                issuedAt,
                issuedById: actor.id,
                issuedByName: actor.name,
            };
            assertInvoiceReconciles(snapshot);
            const invoice = await tx.cateringFiscalInvoice.create({ data: {
                companyId,
                branchId: event.branchId,
                cateringEventId: event.id,
                number: invoiceNumber,
                status: 'ISSUED',
                idempotencyKey,
                requestHash,
                subtotal,
                tax,
                total,
                snapshot: serialize(snapshot),
                issuedAt,
                issuedById: actor.id,
            } });
            await tx.auditLog.create({ data: {
                companyId,
                userId: actor.id,
                entityType: 'CateringFiscalInvoice',
                entityId: invoice.id,
                action: 'ISSUE',
                details: { eventId, invoiceNumber, subtotal, tax, total, paymentIds: event.payments.map((payment) => payment.id) },
            } });
            return snapshot;
        });
    }

    static async getInvoice(eventId: number, companyId: number) {
        const row = await prisma.cateringFiscalInvoice.findFirst({ where: { cateringEventId: eventId, companyId } });
        if (!row) throw new Error('Catering invoice not issued');
        const snapshot = deserializeCateringInvoiceSnapshot(row.snapshot);
        if (snapshot.eventId !== row.cateringEventId || snapshot.invoiceNumber !== row.number) {
            throw new Error('Catering fiscal snapshot does not match its document');
        }
        return snapshot;
    }

    private static normalizeCreditInput(input: CateringCreditNoteInput) {
        const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (reason.length < 5 || reason.length > 500) throw new Error('El motivo debe tener entre 5 y 500 caracteres');
        if (input.inventoryAction !== 'NO_RETURN' && input.inventoryAction !== 'RETURN_TO_STOCK') {
            throw new Error('Debe indicar el tratamiento físico del inventario');
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
            throw new Error('No se puede repetir un pago en los reembolsos externos');
        }
        const requestHash = createHash('sha256').update(JSON.stringify({ reason, inventoryAction: input.inventoryAction, externalRefunds })).digest('hex');
        return { idempotencyKey, reason, inventoryAction: input.inventoryAction, externalRefunds, requestHash };
    }

    static async issueFullCreditNote(eventId: number, companyId: number, userId: number, input: CateringCreditNoteInput) {
        const normalized = this.normalizeCreditInput(input);
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${eventId} AND companyId = ${companyId} FOR UPDATE`;
            const event = await tx.cateringEvent.findFirst({
                where: { id: eventId, companyId },
                include: { fiscalInvoice: true, fiscalCreditNote: true, payments: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } } },
            });
            if (!event) throw new Error('Catering event not found');
            const actor = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true, name: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');

            const existingByKey = await tx.cateringFiscalCreditNote.findUnique({
                where: { companyId_idempotencyKey: { companyId, idempotencyKey: normalized.idempotencyKey } },
            });
            const existing = event.fiscalCreditNote || existingByKey;
            if (existing) {
                if (existing.cateringEventId !== eventId || existing.idempotencyKey !== normalized.idempotencyKey || existing.requestHash !== normalized.requestHash) {
                    throw new Error('La factura ya tiene otra nota de crédito o la clave de idempotencia fue reutilizada');
                }
                return deserializeCateringCreditNoteSnapshot(existing.snapshot);
            }
            if (!event.fiscalInvoice || event.fiscalInvoice.status !== 'ISSUED') {
                throw new Error('Solo una factura de catering emitida puede recibir nota de crédito');
            }
            if (event.status !== 'PAID' && event.status !== 'FINISHED') {
                throw new Error('El evento no está en un estado fiscalmente reversible');
            }
            const originalInvoice = deserializeCateringInvoiceSnapshot(event.fiscalInvoice.snapshot);
            if (originalInvoice.eventId !== event.id || originalInvoice.invoiceNumber !== event.fiscalInvoice.number) {
                throw new Error('Catering fiscal snapshot does not match its document');
            }
            const activePaidCents = event.payments.reduce((sum, payment) => sum + cents(payment.amount, 'payment.amount'), 0);
            if (activePaidCents !== cents(originalInvoice.total, 'invoice.total')) {
                throw new Error('Los pagos activos no concilian con la factura de catering');
            }

            const jurisdictionName = `${companyId}_fiscal_jurisdiction`;
            const seriesName = `${companyId}_credit_note_series`;
            const settings = await tx.setting.findMany({
                where: { companyId, name: { in: [jurisdictionName, seriesName] } },
                select: { name: true, value: true },
            });
            const settingMap = new Map(settings.map((setting) => [setting.name, setting.value.trim()]));
            const jurisdiction = settingMap.get(jurisdictionName) || '';
            const series = settingMap.get(seriesName) || '';
            if (!jurisdiction || jurisdiction.length > 32) throw new Error('Configure explícitamente la jurisdicción fiscal');
            if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(series)) throw new Error('Configure una serie de nota de crédito válida');

            await tx.creditNoteSequence.upsert({
                where: { companyId_series: { companyId, series } }, update: {}, create: { companyId, series, lastNumber: 0 },
            });
            const sequence = await tx.creditNoteSequence.update({
                where: { companyId_series: { companyId, series } }, data: { lastNumber: { increment: 1 } },
            });
            const number = `${series}-${sequence.lastNumber.toString().padStart(8, '0')}`;

            const refunds = await CateringService.reverseAllPaymentsForFiscalCredit(tx, {
                eventId,
                companyId,
                userId: actor.id,
                creditNoteNumber: number,
                reason: normalized.reason,
                externalRefunds: normalized.externalRefunds,
            });

            let inventoryDisposition: CreditNoteInventoryDisposition = 'NOT_CONSUMED';
            if (event.status === 'FINISHED') {
                if (normalized.inventoryAction === 'RETURN_TO_STOCK') {
                    await this.reverseFinishedInventory(tx, { eventId, companyId, userId: actor.id, creditNoteNumber: number });
                    inventoryDisposition = 'RETURNED_TO_ORIGINAL_STOCK';
                } else {
                    inventoryDisposition = 'NOT_RETURNED';
                }
            }
            const issuedAt = new Date();
            const snapshot: CateringCreditNoteData = {
                eventId,
                creditNoteNumber: number,
                originalInvoiceNumber: originalInvoice.invoiceNumber,
                status: 'ISSUED',
                reason: normalized.reason,
                jurisdiction,
                inventoryDisposition,
                refunds,
                issuedAt,
                issuedById: actor.id,
                issuedByName: actor.name,
                originalInvoice,
            };
            const row = await tx.cateringFiscalCreditNote.create({ data: {
                companyId,
                branchId: event.branchId,
                cateringEventId: event.id,
                cateringFiscalInvoiceId: event.fiscalInvoice.id,
                number,
                series,
                sequenceNumber: sequence.lastNumber,
                originalInvoiceNumber: originalInvoice.invoiceNumber,
                reason: normalized.reason,
                jurisdiction,
                idempotencyKey: normalized.idempotencyKey,
                requestHash: normalized.requestHash,
                subtotal: originalInvoice.subtotal,
                tax: originalInvoice.tax,
                total: originalInvoice.total,
                inventoryDisposition,
                snapshot: serialize(snapshot),
                issuedAt,
                issuedById: actor.id,
            } });
            await tx.cateringFiscalInvoice.update({ where: { id: event.fiscalInvoice.id }, data: { status: 'CREDITED' } });
            await tx.cateringEvent.update({ where: { id: event.id }, data: { status: 'CANCELLED', balance: event.totalAmount } });
            await tx.auditLog.create({ data: {
                companyId,
                userId: actor.id,
                entityType: 'CateringFiscalCreditNote',
                entityId: row.id,
                action: 'ISSUE',
                details: { eventId, number, originalInvoiceNumber: originalInvoice.invoiceNumber, total: originalInvoice.total, inventoryDisposition, refundedPaymentIds: refunds.map((refund) => refund.paymentId) },
            } });
            return snapshot;
        });
    }

    static async getCreditNote(eventId: number, companyId: number) {
        const row = await prisma.cateringFiscalCreditNote.findFirst({ where: { cateringEventId: eventId, companyId } });
        if (!row) throw new Error('Catering credit note not issued');
        const snapshot = deserializeCateringCreditNoteSnapshot(row.snapshot);
        if (snapshot.eventId !== row.cateringEventId || snapshot.creditNoteNumber !== row.number) {
            throw new Error('Catering credit note snapshot does not match its document');
        }
        return snapshot;
    }

    private static async reverseFinishedInventory(
        tx: Prisma.TransactionClient,
        params: { eventId: number; companyId: number; userId: number; creditNoteNumber: string },
    ) {
        const movements = await tx.inventoryMovement.findMany({
            where: { companyId: params.companyId, reference: `EVT-${params.eventId}`, type: 'OUT' },
            orderBy: [{ productId: 'asc' }, { id: 'asc' }],
            select: { id: true, warehouseId: true, productId: true, quantity: true, totalCost: true, consumedLayers: true },
        });
        if (movements.length === 0) throw new Error('El evento finalizado no tiene consumo de inventario reversible');
        const costingMethod = (await tx.company.findUnique({
            where: { id: params.companyId },
            select: { costingMethod: true }
        }))?.costingMethod || 'WEIGHTED_AVERAGE';
        for (const movement of movements) {
            const priorReversal = await tx.inventoryMovement.findFirst({
                where: { companyId: params.companyId, reversalOfId: movement.id },
                select: { id: true }
            });
            if (priorReversal) throw new Error(`El movimiento ${movement.id} ya tiene una reversa de inventario`);
            if (!Array.isArray(movement.consumedLayers) || movement.consumedLayers.length === 0) {
                throw new Error(`El movimiento ${movement.id} no conserva capas de costo para una devolución exacta`);
            }
            const inboundLayers = movement.consumedLayers.map((raw, index) => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Capa inválida en movimiento ${movement.id}`);
                const layer = raw as JsonRecord;
                const quantity = Number(layer.quantity);
                const unitCost = Number(layer.unitCost);
                if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
                    throw new Error(`Capa inválida en movimiento ${movement.id}:${index}`);
                }
                return {
                    quantity,
                    unitCost,
                    sourceRef: optionalString(layer.sourceRef) || null,
                    sourceType: (optionalString(layer.sourceType) as BatchSourceType | undefined) || 'ADJUSTMENT',
                    createdAt: optionalString(layer.createdAt) ? new Date(String(layer.createdAt)) : undefined,
                };
            });
            const quantity = Number(movement.quantity);
            const layerQuantity = inboundLayers.reduce((sum, layer) => sum + layer.quantity, 0);
            const layerValue = inboundLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0);
            if (Math.abs(layerQuantity - quantity) > 1e-6 || movement.totalCost == null || Math.abs(layerValue - Number(movement.totalCost)) > 1e-4) {
                throw new Error(`El costo/cantidad del movimiento ${movement.id} no concilia para devolución`);
            }
            const weightedContext = costingMethod === 'WEIGHTED_AVERAGE'
                ? await Promise.all([
                    tx.stock.aggregate({ where: { companyId: params.companyId, productId: movement.productId }, _sum: { quantity: true } }),
                    tx.product.findFirst({
                        where: { id: movement.productId, companyId: params.companyId },
                        select: { currentAverageCost: true, averageCostKnown: true }
                    })
                ])
                : null;
            const reversalGroupId = `CAT-NC-${params.creditNoteNumber}`;
            const reversalKey = `${reversalGroupId}-MOV-${movement.id}`;
            await InventoryEngineService.applyMovement(tx, {
                type: 'ADJUSTMENT',
                direction: 'IN',
                origin: 'REVERSAL',
                companyId: params.companyId,
                warehouseId: movement.warehouseId,
                productId: movement.productId,
                userId: params.userId,
                quantity,
                inboundLayers,
                sourceType: 'ADJUSTMENT',
                reference: reversalKey,
                reason: `Devolución completa Catering #${params.eventId} / ${params.creditNoteNumber}`,
                reversalOfId: movement.id,
                reversalGroupId,
                reversalKey,
            });
            if (costingMethod === 'FIFO') {
                await CostingService.syncFifoCurrentAverageCost(tx, movement.productId, params.companyId);
            } else if (weightedContext) {
                const previousQuantity = Number(weightedContext[0]._sum.quantity ?? 0);
                const product = weightedContext[1];
                if (!product || !product.averageCostKnown || !Number.isFinite(Number(product.currentAverageCost))) {
                    throw new Error(`El producto ${movement.productId} no tiene costo promedio confirmado para la devolución`);
                }
                const newAverageCost = (previousQuantity * Number(product.currentAverageCost) + layerValue) / (previousQuantity + quantity);
                await tx.product.update({
                    where: { id: movement.productId },
                    data: { currentAverageCost: newAverageCost, averageCostKnown: true }
                });
            }
        }
    }
}
