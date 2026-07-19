import { createHash } from 'crypto';
import type { CreditNoteInventoryDisposition, PaymentMethodType, Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import prisma from '../utils/prisma';
import { isValidTimeZone, zonedDateKey } from '../utils/timezone';
import { deserializeInvoiceSnapshot, type InvoiceData } from './invoice.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { DEFAULT_COMPANY_SETTINGS, validateConfiguredFiscalTaxId } from './setting.service';
import { UnitConversionService } from './unit-conversion.service';
import { closeInactiveTableGroupForTable } from './table-group.service';

export interface CreditNoteIssueInput {
    idempotencyKey?: unknown;
    reason?: unknown;
    inventoryAction?: unknown;
    wasteWarehouseId?: unknown;
    externalRefunds?: Array<{ paymentId?: unknown; reference?: unknown }>;
    /** Omit for a full credit of every still-available invoice unit. */
    lines?: Array<{ orderItemId?: unknown; quantity?: unknown }>;
}

export interface CreditNoteLineData {
    orderItemId?: number;
    name: string;
    quantity: number;
    unitPrice: number;
    grossSubtotal: number;
    discount: number;
    subtotal: number;
    tax: number;
    tipAmount: number;
    total: number;
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
    lines: CreditNoteLineData[];
    subtotal: number;
    tax: number;
    tipAmount: number;
    total: number;
    isFinal: boolean;
    creditedTotal: number;
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
    lines?: Array<{ orderItemId: number; quantity: number }>;
    requestHash: string;
}

interface InvoiceLineAllocation {
    orderItemId: number;
    name: string;
    quantity: number;
    unitPriceCents: number;
    grossCents: number;
    discountCents: number;
    subtotalCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
}

const creditOrderItemInclude = {
    menuItem: { include: { recipes: { include: { product: { include: { baseUnit: true } }, unitOfMeasure: true } } } },
    modifiers: { include: { modifier: { include: { product: true, unit: true } } } }
} satisfies Prisma.OrderItemInclude;

type CreditOrderItem = Prisma.OrderItemGetPayload<{ include: typeof creditOrderItemInclude }>;

const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => value / 100;

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Credit note snapshot is invalid: ${field}`);
    return value;
}

function positiveInteger(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Credit note snapshot is invalid: ${field}`);
    return number;
}

function finiteMoney(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`Credit note snapshot is invalid: ${field}`);
    return number;
}

function allocateCents(total: number, weights: number[], tieBreakers: number[]): number[] {
    if (total === 0) return weights.map(() => 0);
    const denominator = weights.reduce((sum, weight) => sum + weight, 0);
    if (denominator <= 0) throw new Error('Invoice snapshot totals cannot be allocated');
    const exact = weights.map((weight) => total * weight / denominator);
    const result = exact.map(Math.floor);
    const remainder = total - result.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, fraction: value - result[index], tie: tieBreakers[index] }))
        .sort((a, b) => b.fraction - a.fraction || a.tie - b.tie);
    for (let index = 0; index < remainder; index += 1) result[order[index].index] += 1;
    return result;
}

function cumulativePortion(total: number, previousQuantity: number, addedQuantity: number, fullQuantity: number): number {
    return Math.round(total * (previousQuantity + addedQuantity) / fullQuantity)
        - Math.round(total * previousQuantity / fullQuantity);
}

function serializeSnapshot(data: CreditNoteData): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({
        ...data,
        issuedAt: data.issuedAt.toISOString(),
        originalInvoice: { ...data.originalInvoice, date: data.originalInvoice.date.toISOString() }
    })) as Prisma.InputJsonValue;
}

export function deserializeCreditNoteSnapshot(snapshot: Prisma.JsonValue): CreditNoteData {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Credit note snapshot is invalid');
    const raw = snapshot as Record<string, Prisma.JsonValue>;
    const issuedAt = new Date(requiredString(raw.issuedAt, 'issuedAt'));
    if (Number.isNaN(issuedAt.getTime())) throw new Error('Credit note snapshot is invalid: issuedAt');
    const disposition = requiredString(raw.inventoryDisposition, 'inventoryDisposition');
    if (!['NOT_CONSUMED', 'NOT_RETURNED', 'RETURNED_TO_ORIGINAL_STOCK'].includes(disposition)) {
        throw new Error('Credit note snapshot is invalid: inventoryDisposition');
    }
    if (!Array.isArray(raw.refunds)) throw new Error('Credit note snapshot is invalid: refunds');
    const originalInvoice = deserializeInvoiceSnapshot(raw.originalInvoice);
    const parsedLines = Array.isArray(raw.lines)
        ? raw.lines.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Credit note snapshot is invalid: lines[${index}]`);
            const line = entry as Record<string, Prisma.JsonValue>;
            return {
                orderItemId: line.orderItemId == null ? undefined : positiveInteger(line.orderItemId, `lines[${index}].orderItemId`),
                name: requiredString(line.name, `lines[${index}].name`),
                quantity: positiveInteger(line.quantity, `lines[${index}].quantity`),
                unitPrice: finiteMoney(line.unitPrice, `lines[${index}].unitPrice`),
                grossSubtotal: finiteMoney(line.grossSubtotal, `lines[${index}].grossSubtotal`),
                discount: finiteMoney(line.discount, `lines[${index}].discount`),
                subtotal: finiteMoney(line.subtotal, `lines[${index}].subtotal`),
                tax: finiteMoney(line.tax, `lines[${index}].tax`),
                tipAmount: finiteMoney(line.tipAmount, `lines[${index}].tipAmount`),
                total: finiteMoney(line.total, `lines[${index}].total`)
            };
        })
        : originalInvoice.items.map((item) => ({
            orderItemId: item.orderItemId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            grossSubtotal: item.subtotal,
            discount: 0,
            subtotal: item.subtotal,
            tax: 0,
            tipAmount: 0,
            total: item.subtotal
        }));
    const subtotal = raw.subtotal == null ? originalInvoice.subtotal : finiteMoney(raw.subtotal, 'subtotal');
    const tax = raw.tax == null ? originalInvoice.tax : finiteMoney(raw.tax, 'tax');
    const tipAmount = raw.tipAmount == null ? originalInvoice.tipAmount : finiteMoney(raw.tipAmount, 'tipAmount');
    const total = raw.total == null ? originalInvoice.total : finiteMoney(raw.total, 'total');
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
        lines: parsedLines,
        subtotal,
        tax,
        tipAmount,
        total,
        isFinal: raw.isFinal == null ? true : raw.isFinal === true,
        creditedTotal: raw.creditedTotal == null ? total : finiteMoney(raw.creditedTotal, 'creditedTotal'),
        refunds: raw.refunds.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Credit note snapshot is invalid: refunds[${index}]`);
            const refund = entry as Record<string, Prisma.JsonValue>;
            const methodType = requiredString(refund.methodType, `refunds[${index}].methodType`);
            if (!['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'].includes(methodType)) {
                throw new Error(`Credit note snapshot is invalid: refunds[${index}].methodType`);
            }
            const amount = finiteMoney(refund.amount, `refunds[${index}].amount`);
            if (amount <= 0) throw new Error(`Credit note snapshot is invalid: refunds[${index}].amount`);
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
    if (cents(data.subtotal + data.tax + data.tipAmount) !== cents(data.total)) {
        throw new Error('Credit note snapshot totals do not reconcile');
    }
    return data;
}

export class CreditNoteService {
    private static normalizeInput(input: CreditNoteIssueInput): NormalizedIssueInput {
        const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (idempotencyKey.length < 8 || idempotencyKey.length > 191) throw new Error('La clave de idempotencia debe tener entre 8 y 191 caracteres');
        if (reason.length < 5 || reason.length > 500) throw new Error('El motivo de la nota de crédito debe tener entre 5 y 500 caracteres');
        if (input.inventoryAction !== 'NO_RETURN' && input.inventoryAction !== 'RETURN_TO_STOCK') {
            throw new Error('Debe indicar si la mercadería fue devuelta físicamente');
        }
        const wasteWarehouseId = input.wasteWarehouseId == null || input.wasteWarehouseId === '' ? undefined : Number(input.wasteWarehouseId);
        if (wasteWarehouseId !== undefined && (!Number.isInteger(wasteWarehouseId) || wasteWarehouseId <= 0)) throw new Error('La bodega de merma no es válida');
        const externalRefunds = (input.externalRefunds || []).map((entry) => {
            const paymentId = Number(entry.paymentId);
            const reference = typeof entry.reference === 'string' ? entry.reference.trim() : '';
            if (!Number.isInteger(paymentId) || paymentId <= 0 || !reference || reference.length > 191) {
                throw new Error('Cada reembolso externo requiere pago y referencia verificable');
            }
            return { paymentId, reference };
        }).sort((a, b) => a.paymentId - b.paymentId);
        if (new Set(externalRefunds.map((entry) => entry.paymentId)).size !== externalRefunds.length) throw new Error('No se puede repetir un pago en las referencias de reembolso');
        let lines: NormalizedIssueInput['lines'];
        if (input.lines !== undefined) {
            if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error('Seleccione al menos una línea para la devolución parcial');
            lines = input.lines.map((line) => {
                const orderItemId = Number(line.orderItemId);
                const quantity = Number(line.quantity);
                if (!Number.isInteger(orderItemId) || orderItemId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
                    throw new Error('Cada línea devuelta requiere un artículo y cantidad entera positiva');
                }
                return { orderItemId, quantity };
            }).sort((a, b) => a.orderItemId - b.orderItemId);
            if (new Set(lines.map((line) => line.orderItemId)).size !== lines.length) throw new Error('No se puede repetir una línea en la misma nota de crédito');
        }
        const requestHash = createHash('sha256').update(JSON.stringify({
            reason,
            inventoryAction: input.inventoryAction,
            wasteWarehouseId: wasteWarehouseId ?? null,
            externalRefunds,
            lines: lines || null
        })).digest('hex');
        return { idempotencyKey, reason, inventoryAction: input.inventoryAction, wasteWarehouseId, externalRefunds, lines, requestHash };
    }

    private static buildInvoiceAllocations(originalInvoice: InvoiceData, orderItems: Array<{ id: number; quantity: number; price: Prisma.Decimal; subtotal: Prisma.Decimal }>): InvoiceLineAllocation[] {
        if (originalInvoice.items.length !== orderItems.length) throw new Error('Invoice snapshot lines do not match the immutable order');
        const invoiceById = new Map(originalInvoice.items.filter((item) => item.orderItemId).map((item) => [item.orderItemId!, item]));
        const matched = orderItems.map((orderItem, index) => {
            const invoiceItem = invoiceById.size > 0 ? invoiceById.get(orderItem.id) : originalInvoice.items[index];
            if (!invoiceItem || invoiceItem.quantity !== orderItem.quantity || cents(invoiceItem.price) !== cents(Number(orderItem.price)) || cents(invoiceItem.subtotal) !== cents(Number(orderItem.subtotal))) {
                throw new Error('Invoice snapshot lines do not match the immutable order');
            }
            return { orderItemId: orderItem.id, item: invoiceItem };
        });
        if (new Set(matched.map((line) => line.orderItemId)).size !== matched.length) throw new Error('Invoice snapshot lines are ambiguous');
        const gross = matched.map(({ item }) => cents(item.subtotal));
        if (gross.reduce((sum, value) => sum + value, 0) !== cents(originalInvoice.grossSubtotal)) throw new Error('Invoice snapshot gross subtotal does not reconcile');
        const ids = matched.map(({ orderItemId }) => orderItemId);
        const discount = allocateCents(cents(originalInvoice.discount), gross, ids);
        const net = gross.map((value, index) => value - discount[index]);
        const tax = allocateCents(cents(originalInvoice.tax), net.some((value) => value > 0) ? net : gross, ids);
        const tip = allocateCents(cents(originalInvoice.tipAmount), net.some((value) => value > 0) ? net : gross, ids);
        return matched.map(({ orderItemId, item }, index) => ({
            orderItemId,
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: cents(item.price),
            grossCents: gross[index],
            discountCents: discount[index],
            subtotalCents: net[index],
            taxCents: tax[index],
            tipCents: tip[index],
            totalCents: net[index] + tax[index] + tip[index]
        }));
    }

    private static async returnedInventoryQuantities(
        tx: Prisma.TransactionClient,
        companyId: number,
        selected: Array<{ orderItemId: number; quantity: number }>,
        orderItems: CreditOrderItem[]
    ): Promise<Array<{ productId: number; quantity: number }>> {
        const requested = new Map(selected.map((line) => [line.orderItemId, line.quantity]));
        const quantities = new Map<number, number>();
        for (const item of orderItems) {
            const returnedQuantity = requested.get(item.id);
            if (!returnedQuantity) continue;
            for (const recipe of item.menuItem.recipes) {
                const recipeUnit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.baseUnit?.abbreviation || recipe.product.unit;
                const converted = await UnitConversionService.convert(recipe.productId, companyId, Number(recipe.quantity), recipeUnit, tx);
                quantities.set(recipe.productId, (quantities.get(recipe.productId) || 0) + converted.baseQuantity * returnedQuantity);
            }
            for (const selectedModifier of item.modifiers) {
                const modifier = selectedModifier.modifier;
                if (!modifier.productId || !modifier.product || !(Number(modifier.consumeQuantity) > 0)) continue;
                const unit = modifier.unit?.abbreviation || modifier.product.unit;
                const converted = await UnitConversionService.convert(modifier.productId, companyId, Number(modifier.consumeQuantity), unit, tx);
                quantities.set(modifier.productId, (quantities.get(modifier.productId) || 0) + converted.baseQuantity * returnedQuantity);
            }
        }
        return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
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
                    table: { select: { id: true } },
                    payments: { orderBy: { id: 'asc' }, include: { fiscalCreditNoteRefunds: true } },
                    fiscalCreditNotes: { orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }], include: { lines: true, refunds: true } },
                    items: {
                        orderBy: { id: 'asc' },
                        include: creditOrderItemInclude
                    }
                }
            });
            if (!order) throw new Error('Order not found or unauthorized');
            const actor = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true, name: true } });
            if (!actor) throw new Error('Invalid user for this company');

            const existingByKey = await tx.fiscalCreditNote.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: normalized.idempotencyKey } } });
            if (existingByKey) {
                if (existingByKey.orderId !== order.id || existingByKey.requestHash !== normalized.requestHash) throw new Error('La clave de idempotencia fue reutilizada con otra devolución');
                return deserializeCreditNoteSnapshot(existingByKey.snapshot);
            }
            if (!order.invoiceNumber || order.invoiceSnapshot === null || !['ISSUED', 'PARTIALLY_CREDITED'].includes(order.invoiceFiscalStatus)) {
                throw new Error('Solo una factura emitida, íntegra y con saldo puede recibir nota de crédito');
            }
            if (order.status !== 'DELIVERED' || order.financialStatus !== 'PAID') {
                throw new Error('La nota de crédito se reserva para ventas entregadas y liquidadas; use anulación para una factura previa a entrega');
            }
            if (normalized.wasteWarehouseId !== undefined) throw new Error('Una nota de crédito post-entrega no acepta bodega de merma');
            const originalInvoice = deserializeInvoiceSnapshot(order.invoiceSnapshot);
            if (originalInvoice.orderId !== order.id || originalInvoice.invoiceNumber !== order.invoiceNumber) throw new Error('Invoice snapshot does not match its order');
            const originalPaymentCents = order.payments.reduce((sum, payment) => sum + cents(Number(payment.amount)), 0);
            if (originalPaymentCents !== cents(originalInvoice.total)) throw new Error('Los pagos originales no concilian con la factura; requiere remediación antes de acreditar');

            const allocations = this.buildInvoiceAllocations(originalInvoice, order.items);
            const creditedByItem = new Map<number, number>();
            for (const note of order.fiscalCreditNotes) for (const line of note.lines) creditedByItem.set(line.orderItemId, (creditedByItem.get(line.orderItemId) || 0) + line.quantity);
            const selected = normalized.lines || allocations.map((line) => ({
                orderItemId: line.orderItemId,
                quantity: line.quantity - (creditedByItem.get(line.orderItemId) || 0)
            })).filter((line) => line.quantity > 0);
            if (selected.length === 0) throw new Error('La factura ya no tiene cantidades disponibles para acreditar');
            const selectedMap = new Map(selected.map((line) => [line.orderItemId, line.quantity]));
            for (const line of selected) {
                const definition = allocations.find((candidate) => candidate.orderItemId === line.orderItemId);
                if (!definition) throw new Error(`La línea #${line.orderItemId} no pertenece a la factura`);
                const previous = creditedByItem.get(line.orderItemId) || 0;
                if (previous + line.quantity > definition.quantity) throw new Error(`La devolución excede la cantidad facturada de la línea #${line.orderItemId}`);
            }
            const noteLines: CreditNoteLineData[] = allocations.filter((line) => selectedMap.has(line.orderItemId)).map((line) => {
                const previous = creditedByItem.get(line.orderItemId) || 0;
                const quantity = selectedMap.get(line.orderItemId)!;
                const grossCents = cumulativePortion(line.grossCents, previous, quantity, line.quantity);
                const discountCents = cumulativePortion(line.discountCents, previous, quantity, line.quantity);
                const subtotalCents = cumulativePortion(line.subtotalCents, previous, quantity, line.quantity);
                const taxCents = cumulativePortion(line.taxCents, previous, quantity, line.quantity);
                const tipCents = cumulativePortion(line.tipCents, previous, quantity, line.quantity);
                return {
                    orderItemId: line.orderItemId, name: line.name, quantity, unitPrice: money(line.unitPriceCents),
                    grossSubtotal: money(grossCents), discount: money(discountCents), subtotal: money(subtotalCents),
                    tax: money(taxCents), tipAmount: money(tipCents), total: money(subtotalCents + taxCents + tipCents)
                };
            });
            const subtotalCents = noteLines.reduce((sum, line) => sum + cents(line.subtotal), 0);
            const taxCents = noteLines.reduce((sum, line) => sum + cents(line.tax), 0);
            const tipCents = noteLines.reduce((sum, line) => sum + cents(line.tipAmount), 0);
            const totalCents = subtotalCents + taxCents + tipCents;
            if (totalCents <= 0) throw new Error('La selección no produce un monto fiscal acreditable');
            const previousCreditCents = order.fiscalCreditNotes.reduce((sum, note) => sum + cents(Number(note.total)), 0);
            if (previousCreditCents + totalCents > cents(originalInvoice.total)) throw new Error('La devolución excede el saldo fiscal de la factura');
            const isFinal = allocations.every((line) => (creditedByItem.get(line.orderItemId) || 0) + (selectedMap.get(line.orderItemId) || 0) === line.quantity);
            if (isFinal && previousCreditCents + totalCents !== cents(originalInvoice.total)) throw new Error('Las cantidades acreditadas no concilian con el saldo monetario de la factura');

            const jurisdictionName = `${companyId}_fiscal_jurisdiction`;
            const seriesName = `${companyId}_credit_note_series`;
            const taxIdLengthName = `${companyId}_fiscal_tax_id_length`;
            const taxIdCharsetName = `${companyId}_fiscal_tax_id_charset`;
            await tx.$queryRaw`SELECT id FROM \`Setting\` WHERE companyId = ${companyId} AND name IN (${jurisdictionName}, ${seriesName}, ${taxIdLengthName}, ${taxIdCharsetName}) FOR UPDATE`;
            const fiscalSettings = await tx.setting.findMany({ where: { companyId, name: { in: [jurisdictionName, seriesName, taxIdLengthName, taxIdCharsetName] } }, select: { name: true, value: true } });
            const settingMap = new Map(fiscalSettings.map((setting) => [setting.name, setting.value.trim()]));
            const jurisdiction = settingMap.get(jurisdictionName) || '';
            const series = settingMap.get(seriesName) || '';
            if (!jurisdiction || jurisdiction.length > 32) throw new Error('Configure explícitamente la jurisdicción fiscal antes de emitir notas de crédito');
            if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(series)) throw new Error('Configure una serie de nota de crédito válida (A-Z, 0-9 y guion; máximo 20)');
            if (!order.branch.company.ruc?.trim()) throw new Error('El RUC del emisor es obligatorio para emitir la nota de crédito');
            const taxSettings = { fiscal_tax_id_length: settingMap.get(taxIdLengthName) || '', fiscal_tax_id_charset: settingMap.get(taxIdCharsetName) || '' };
            validateConfiguredFiscalTaxId(order.branch.company.ruc, taxSettings, 'El RUC del emisor');
            if (originalInvoice.customerRuc) validateConfiguredFiscalTaxId(originalInvoice.customerRuc, taxSettings, 'La identificación tributaria del cliente');

            const referenceMap = new Map(normalized.externalRefunds.map((entry) => [entry.paymentId, entry.reference]));
            if ([...referenceMap.keys()].some((paymentId) => !order.payments.some((payment) => payment.id === paymentId && payment.methodType !== 'CASH'))) {
                throw new Error('Se recibió una referencia para un pago que no pertenece a la factura o es efectivo');
            }
            await tx.creditNoteSequence.upsert({ where: { companyId_series: { companyId, series } }, update: {}, create: { companyId, series, lastNumber: 0 } });
            const sequence = await tx.creditNoteSequence.update({ where: { companyId_series: { companyId, series } }, data: { lastNumber: { increment: 1 } } });
            const number = `${series}-${sequence.lastNumber.toString().padStart(8, '0')}`;
            let remainingRefundCents = totalCents;
            const refunds: CreditNoteData['refunds'] = [];
            for (const payment of order.payments) {
                if (remainingRefundCents <= 0) break;
                const alreadyRefunded = payment.fiscalCreditNoteRefunds.reduce((sum, refund) => sum + cents(Number(refund.amount)), 0);
                const available = cents(Number(payment.amount)) - alreadyRefunded;
                if (available <= 0) continue;
                const amountCents = Math.min(available, remainingRefundCents);
                const reference = payment.methodType === 'CASH'
                    ? `CN-REF-${number}-PAY-${payment.id}`
                    : referenceMap.get(payment.id);
                if (!reference) throw new Error(`Registre la referencia del reembolso externo para el pago #${payment.id}`);
                refunds.push({ paymentId: payment.id, methodType: payment.methodType, amount: money(amountCents), reference });
                remainingRefundCents -= amountCents;
            }
            if (remainingRefundCents !== 0) throw new Error('Los pagos no tienen saldo suficiente para respaldar la devolución');

            const issuedAt = new Date();
            const inventoryDisposition: CreditNoteInventoryDisposition = normalized.inventoryAction === 'RETURN_TO_STOCK' ? 'RETURNED_TO_ORIGINAL_STOCK' : 'NOT_RETURNED';
            const snapshot: CreditNoteData = {
                orderId: order.id, creditNoteNumber: number, series, sequenceNumber: sequence.lastNumber, status: 'ISSUED',
                originalInvoiceNumber: order.invoiceNumber, reason: normalized.reason, jurisdiction, issuedAt,
                issuedById: actor.id, issuedByName: actor.name, inventoryDisposition, lines: noteLines,
                subtotal: money(subtotalCents), tax: money(taxCents), tipAmount: money(tipCents), total: money(totalCents),
                isFinal, creditedTotal: money(previousCreditCents + totalCents), refunds, originalInvoice
            };
            const creditNote = await tx.fiscalCreditNote.create({
                data: {
                    companyId, branchId: order.branchId, orderId: order.id, number, series, sequenceNumber: sequence.lastNumber,
                    status: 'ISSUED', originalInvoiceNumber: order.invoiceNumber, reason: normalized.reason, jurisdiction,
                    idempotencyKey: normalized.idempotencyKey, requestHash: normalized.requestHash,
                    subtotal: snapshot.subtotal, tax: snapshot.tax, tipAmount: snapshot.tipAmount, total: snapshot.total,
                    inventoryDisposition, snapshot: serializeSnapshot(snapshot), issuedAt, issuedById: actor.id,
                    lines: { create: noteLines.map((line) => ({
                        orderItemId: line.orderItemId!, quantity: line.quantity, grossSubtotal: line.grossSubtotal,
                        discount: line.discount, subtotal: line.subtotal, tax: line.tax, tipAmount: line.tipAmount, total: line.total
                    })) },
                    refunds: { create: refunds.map((refund) => ({ paymentId: refund.paymentId, amount: refund.amount, reference: refund.reference })) }
                }
            });

            for (const refund of refunds.filter((entry) => entry.methodType === 'CASH')) {
                const payment = order.payments.find((candidate) => candidate.id === refund.paymentId)!;
                const inbound = await tx.cashMovement.findMany({
                    where: { reference: `PAY-${payment.id}` },
                    select: { type: true, amount: true, shift: { select: { companyId: true, cashRegister: { select: { branchId: true } } } } }
                });
                if (inbound.length !== 1 || inbound[0].type !== 'IN' || cents(Number(inbound[0].amount)) !== cents(Number(payment.amount)) || inbound[0].shift.companyId !== companyId || inbound[0].shift.cashRegister.branchId !== order.branchId) {
                    throw new Error(`El pago en efectivo #${payment.id} no tiene un asiento PAY íntegro; requiere remediación manual`);
                }
                const refundShift = await tx.cashShift.findFirst({
                    where: { userId: actor.id, companyId, endDate: null, cashRegister: { branchId: order.branchId } },
                    select: { id: true, startDate: true }
                });
                if (!refundShift) throw new Error('Debe existir un turno de caja abierto en la sucursal para registrar el reembolso en efectivo');
                const timezoneSetting = await tx.setting.findUnique({ where: { companyId_name: { companyId, name: `${companyId}_timezone` } }, select: { value: true } });
                const configured = timezoneSetting?.value?.trim();
                const timezone = configured && isValidTimeZone(configured) ? configured : DEFAULT_COMPANY_SETTINGS.timezone;
                if (zonedDateKey(refundShift.startDate, timezone) !== zonedDateKey(issuedAt, timezone)) throw new Error('El turno de caja abierto no corresponde al día local del reembolso');
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${refundShift.id} AND companyId = ${companyId} FOR UPDATE`;
                const lockedShift = await tx.cashShift.findFirst({ where: { id: refundShift.id, userId: actor.id, companyId, endDate: null }, select: { id: true } });
                if (!lockedShift) throw new Error('El turno de caja para el reembolso ya fue cerrado');
                await tx.cashMovement.create({ data: { shiftId: lockedShift.id, type: 'OUT', amount: refund.amount, description: `Reembolso ${number} pago #${payment.id}`, reference: refund.reference } });
            }

            if (inventoryDisposition === 'RETURNED_TO_ORIGINAL_STOCK') {
                const fullInitialReturn = order.fiscalCreditNotes.length === 0 && isFinal;
                const physical = fullInitialReturn
                    ? await InventoryConsumptionService.reverseForOrder(tx, {
                        orderId: order.id, userId: actor.id, companyId, reason: `Devolución física respaldada por nota de crédito ${number}`,
                        sourceType: 'ADJUSTMENT', reversalOrigin: `FISCAL_CREDIT_NOTE:${creditNote.id}`
                    })
                    : await InventoryConsumptionService.reverseQuantitiesForOrder(tx, {
                        orderId: order.id, userId: actor.id, companyId, reason: `Devolución física parcial respaldada por nota de crédito ${number}`,
                        sourceType: 'ADJUSTMENT', reversalOrigin: `FISCAL_CREDIT_NOTE:${creditNote.id}`,
                        quantities: await this.returnedInventoryQuantities(tx, companyId, selected, order.items)
                    });
                const inventoryBearing = order.items.filter((item) => selectedMap.has(item.id)).some((item) => item.menuItem.recipes.length > 0 || item.modifiers.some((modifier) => modifier.modifier.productId));
                if (inventoryBearing && !physical.reversed) throw new Error('La orden entregada no tiene consumo íntegro que pueda devolverse; requiere remediación de inventario');
            }

            for (const payment of order.payments) {
                const previous = payment.fiscalCreditNoteRefunds.reduce((sum, refund) => sum + cents(Number(refund.amount)), 0);
                const current = refunds.filter((refund) => refund.paymentId === payment.id).reduce((sum, refund) => sum + cents(refund.amount), 0);
                const refunded = previous + current;
                const paymentCents = cents(Number(payment.amount));
                if (refunded > paymentCents) throw new Error(`La devolución excede el pago #${payment.id}`);
                if (refunded === paymentCents) {
                    const currentRefund = refunds.find((refund) => refund.paymentId === payment.id);
                    await tx.payment.update({ where: { id: payment.id }, data: {
                        status: 'REVERSED', reversedAt: issuedAt, reversedById: actor.id,
                        reversalReason: `Notas de crédito de factura ${order.invoiceNumber}`,
                        ...(currentRefund ? { refundReference: currentRefund.reference } : {})
                    } });
                }
            }

            if (isFinal && order.discountCode) {
                const promotion = await tx.promotion.findFirst({ where: { companyId, code: order.discountCode.toUpperCase() }, select: { id: true, usageCount: true } });
                if (promotion && promotion.usageCount > 0) await tx.promotion.update({ where: { id: promotion.id }, data: { usageCount: { decrement: 1 } } });
            }
            await tx.order.update({
                where: { id: order.id },
                data: isFinal ? {
                    status: 'CANCELLED', financialStatus: 'UNPAID', invoiceFiscalStatus: 'CREDITED',
                    cancelledById: actor.id, cancelReason: `Nota de crédito final ${number}: ${normalized.reason}`,
                    // Preserve sale recognition. Reports publish this gross
                    // closed event and the fiscal note separately at issuedAt.
                    cancelledAt: issuedAt
                } : { financialStatus: 'PAID', invoiceFiscalStatus: 'PARTIALLY_CREDITED' }
            });
            if (isFinal && order.tableId) {
                await closeInactiveTableGroupForTable(
                    tx, companyId, order.tableId, actor.id, `Nota de crédito final ${number}`
                );
            }
            await tx.auditLog.create({ data: {
                companyId, userId: actor.id, entityType: 'FiscalCreditNote', entityId: creditNote.id, action: 'ISSUE',
                details: { number, originalInvoiceNumber: order.invoiceNumber, orderId: order.id, reason: normalized.reason,
                    inventoryDisposition, lines: selected, refunds, total: snapshot.total, creditedTotal: snapshot.creditedTotal, isFinal }
            } });
            return snapshot;
        });
    }

    static async getByOrder(orderId: number, companyId: number): Promise<CreditNoteData> {
        const creditNote = await prisma.fiscalCreditNote.findFirst({ where: { orderId, companyId }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], select: { orderId: true, number: true, snapshot: true } });
        if (!creditNote) throw new Error('Credit note not issued');
        const snapshot = deserializeCreditNoteSnapshot(creditNote.snapshot);
        if (snapshot.orderId !== creditNote.orderId || snapshot.creditNoteNumber !== creditNote.number) throw new Error('Credit note snapshot does not match its document');
        return snapshot;
    }

    static async getById(creditNoteId: number, companyId: number): Promise<{ branchId: number; data: CreditNoteData }> {
        if (!Number.isInteger(creditNoteId) || creditNoteId <= 0) throw new Error('Credit note not issued');
        const creditNote = await prisma.fiscalCreditNote.findFirst({
            where: { id: creditNoteId, companyId },
            select: { orderId: true, branchId: true, number: true, snapshot: true }
        });
        if (!creditNote) throw new Error('Credit note not issued');
        const data = deserializeCreditNoteSnapshot(creditNote.snapshot);
        if (data.orderId !== creditNote.orderId || data.creditNoteNumber !== creditNote.number) {
            throw new Error('Credit note snapshot does not match its document');
        }
        return { branchId: creditNote.branchId, data };
    }

    static async list(companyId: number, filters: { branchId?: number; startDate?: Date; endDate?: Date } = {}) {
        return prisma.fiscalCreditNote.findMany({
            where: { companyId, ...(filters.branchId ? { branchId: filters.branchId } : {}), ...(filters.startDate || filters.endDate ? { issuedAt: { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) } } : {}) },
            select: { id: true, orderId: true, branchId: true, number: true, originalInvoiceNumber: true, reason: true, subtotal: true, tax: true, tipAmount: true, total: true, issuedAt: true, issuedBy: { select: { id: true, name: true } }, lines: { select: { orderItemId: true, quantity: true } } },
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }]
        });
    }

    static async generatePDF(orderId: number, companyId: number): Promise<Buffer> {
        const data = await this.getByOrder(orderId, companyId);
        return this.renderPDF(data);
    }

    static async generatePDFById(creditNoteId: number, companyId: number): Promise<{ branchId: number; pdf: Buffer }> {
        const record = await this.getById(creditNoteId, companyId);
        return { branchId: record.branchId, pdf: this.renderPDF(record.data) };
    }

    private static renderPDF(data: CreditNoteData): Buffer {
        const invoice = data.originalInvoice;
        const doc = new jsPDF();
        const margin = 15;
        doc.setFontSize(18); doc.text(invoice.companyName, margin, 18);
        doc.setFontSize(10); doc.text(`RUC: ${invoice.companyRuc || 'N/A'}`, margin, 25); doc.text(invoice.branchName, margin, 31);
        doc.setFontSize(14); doc.text('NOTA DE CREDITO', 195, 18, { align: 'right' });
        doc.setFontSize(10); doc.text(`Numero: ${data.creditNoteNumber}`, 195, 25, { align: 'right' });
        doc.text(`Factura afectada: ${data.originalInvoiceNumber}`, 195, 31, { align: 'right' });
        doc.text(`Fecha: ${data.issuedAt.toLocaleDateString('es-NI')}`, 195, 37, { align: 'right' });
        doc.text(`Jurisdiccion configurada: ${data.jurisdiction}`, margin, 43);
        doc.text(`Cliente: ${invoice.customerName || 'Consumidor Final'}`, margin, 50);
        doc.text(`${invoice.customerTaxIdType || 'Identificacion'}: ${invoice.customerRuc || 'N/A'}`, margin, 57);
        doc.text(`Motivo: ${data.reason}`, margin, 66, { maxWidth: 180 });
        autoTable(doc, {
            head: [['Descripcion', 'Cant.', 'Precio', 'Importe acreditado']],
            body: data.lines.map((line) => [line.name, line.quantity.toString(), line.unitPrice.toFixed(2), line.total.toFixed(2)]),
            startY: 78, margin: { left: margin, right: margin }, theme: 'striped',
            headStyles: { fillColor: [153, 27, 27], textColor: 255 },
            columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });
        const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
        doc.text('Subtotal neto:', 140, finalY); doc.text(data.subtotal.toFixed(2), 195, finalY, { align: 'right' });
        doc.text('Impuesto:', 140, finalY + 7); doc.text(data.tax.toFixed(2), 195, finalY + 7, { align: 'right' });
        if (data.tipAmount > 0) { doc.text('Propina:', 140, finalY + 14); doc.text(data.tipAmount.toFixed(2), 195, finalY + 14, { align: 'right' }); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('TOTAL ACREDITADO:', 120, finalY + 24);
        doc.text(`${invoice.currencySymbol} ${data.total.toFixed(2)}`, 195, finalY + 24, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(`Estado: ${data.isFinal ? 'credito final' : 'credito parcial'}`, margin, finalY + 38);
        doc.text(`Tratamiento de inventario: ${data.inventoryDisposition}`, margin, finalY + 45);
        doc.text(`Emitida por: ${data.issuedByName}`, margin, finalY + 52);
        return Buffer.from(doc.output('arraybuffer'));
    }
}
