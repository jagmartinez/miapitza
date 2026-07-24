import type { PaymentMethodType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

type MovementDirection = 'IN' | 'OUT';

export type CashMovementCategory =
    | 'POS_SALE'
    | 'CATERING_SALE'
    | 'POS_PAYMENT_REVERSAL'
    | 'CATERING_PAYMENT_REVERSAL'
    | 'CREDIT_NOTE_REFUND'
    | 'MANUAL_INCOME'
    | 'MANUAL_OUTFLOW'
    | 'UNCLASSIFIED_INCOME'
    | 'UNCLASSIFIED_OUTFLOW';

export type CashMovementPaymentOrigin = {
    id: number | null;
    name: string;
    type: PaymentMethodType | null;
    source: 'PAYMENT' | 'CATERING_PAYMENT' | 'MANUAL_CASH_MOVEMENT' | 'UNRESOLVED_REFERENCE';
    nameSource: 'CURRENT_PAYMENT_METHOD_CATALOG' | 'NOT_APPLICABLE';
};

type CashMovementLike = {
    id: number;
    type: MovementDirection;
    amount: Prisma.Decimal | number | string;
    reference?: string | null;
};

type ReferenceClassification = {
    category: CashMovementCategory;
    paymentDomain: 'POS' | 'CATERING' | null;
    paymentId: number | null;
};

const toCents = (value: Prisma.Decimal | number | string): number =>
    Math.round(Number(value) * 100);

const fromCents = (value: number): number => value / 100;

const isPositiveInteger = (value: string): boolean =>
    /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

/**
 * Classifies immutable cash-ledger references. Free text is deliberately not
 * used because descriptions are editable labels, not accounting evidence.
 */
export function classifyCashMovementReference(
    type: MovementDirection,
    reference?: string | null
): ReferenceClassification {
    const normalized = reference?.trim() || '';
    let match = normalized.match(/^PAY-(\d+)$/);
    if (type === 'IN' && match && isPositiveInteger(match[1])) {
        return { category: 'POS_SALE', paymentDomain: 'POS', paymentId: Number(match[1]) };
    }

    match = normalized.match(/^CAT-PAY-(\d+)$/);
    if (type === 'IN' && match && isPositiveInteger(match[1])) {
        return { category: 'CATERING_SALE', paymentDomain: 'CATERING', paymentId: Number(match[1]) };
    }

    match = normalized.match(/^REV-PAY-(\d+)$/);
    if (type === 'OUT' && match && isPositiveInteger(match[1])) {
        return { category: 'POS_PAYMENT_REVERSAL', paymentDomain: 'POS', paymentId: Number(match[1]) };
    }

    match = normalized.match(/^REV-CAT-PAY-(\d+)$/);
    if (type === 'OUT' && match && isPositiveInteger(match[1])) {
        return { category: 'CATERING_PAYMENT_REVERSAL', paymentDomain: 'CATERING', paymentId: Number(match[1]) };
    }

    match = normalized.match(/^CN-REF-.+-PAY-(\d+)$/);
    if (type === 'OUT' && match && isPositiveInteger(match[1])) {
        return { category: 'CREDIT_NOTE_REFUND', paymentDomain: 'POS', paymentId: Number(match[1]) };
    }

    if (!normalized) {
        return {
            category: type === 'IN' ? 'MANUAL_INCOME' : 'MANUAL_OUTFLOW',
            paymentDomain: null,
            paymentId: null
        };
    }

    return {
        category: type === 'IN' ? 'UNCLASSIFIED_INCOME' : 'UNCLASSIFIED_OUTFLOW',
        paymentDomain: null,
        paymentId: null
    };
}

export function summarizeCashMovements(movements: CashMovementLike[]) {
    let totalInCents = 0;
    let totalOutCents = 0;
    let grossSalesCashCents = 0;
    let cashRefundsCents = 0;

    for (const movement of movements) {
        const amountCents = toCents(movement.amount);
        const classification = classifyCashMovementReference(movement.type, movement.reference);

        if (movement.type === 'IN') totalInCents += amountCents;
        else totalOutCents += amountCents;

        if (
            movement.type === 'IN'
            && (classification.category === 'POS_SALE' || classification.category === 'CATERING_SALE')
        ) {
            grossSalesCashCents += amountCents;
        }
        if (
            movement.type === 'OUT'
            && (
                classification.category === 'POS_PAYMENT_REVERSAL'
                || classification.category === 'CATERING_PAYMENT_REVERSAL'
                || classification.category === 'CREDIT_NOTE_REFUND'
            )
        ) {
            cashRefundsCents += amountCents;
        }
    }

    const otherIncomeCents = totalInCents - grossSalesCashCents;
    const otherOutflowsCents = totalOutCents - cashRefundsCents;

    return {
        totalIn: fromCents(totalInCents),
        totalOut: fromCents(totalOutCents),
        grossSalesCash: fromCents(grossSalesCashCents),
        cashRefunds: fromCents(cashRefundsCents),
        totalSalesCash: fromCents(grossSalesCashCents - cashRefundsCents),
        otherIncome: fromCents(otherIncomeCents),
        otherOutflows: fromCents(otherOutflowsCents)
    };
}

export class CashMovementReportService {
    static async enrichForReport<T extends CashMovementLike>(
        movements: T[],
        companyId: number,
        branchId: number
    ): Promise<Array<T & {
        category: CashMovementCategory;
        paymentMethod: CashMovementPaymentOrigin;
    }>> {
        const classifications = movements.map((movement) =>
            classifyCashMovementReference(movement.type, movement.reference)
        );
        const posIds = [...new Set(classifications
            .filter((item) => item.paymentDomain === 'POS' && item.paymentId !== null)
            .map((item) => item.paymentId!))];
        const cateringIds = [...new Set(classifications
            .filter((item) => item.paymentDomain === 'CATERING' && item.paymentId !== null)
            .map((item) => item.paymentId!))];

        const [payments, cateringPayments] = await Promise.all([
            posIds.length === 0
                ? []
                : prisma.payment.findMany({
                    where: {
                        id: { in: posIds },
                        order: { companyId, branchId }
                    },
                    select: {
                        id: true,
                        methodType: true,
                        paymentMethod: { select: { id: true, name: true } }
                    }
                }),
            cateringIds.length === 0
                ? []
                : prisma.cateringPayment.findMany({
                    where: {
                        id: { in: cateringIds },
                        event: { companyId, branchId }
                    },
                    select: {
                        id: true,
                        methodType: true,
                        paymentMethod: { select: { id: true, name: true } }
                    }
                })
        ]);
        const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
        const cateringPaymentById = new Map(cateringPayments.map((payment) => [payment.id, payment]));

        return movements.map((movement, index) => {
            const classification = classifications[index];
            if (classification.paymentId !== null) {
                const payment = classification.paymentDomain === 'POS'
                    ? paymentById.get(classification.paymentId)
                    : cateringPaymentById.get(classification.paymentId);
                if (payment) {
                    return {
                        ...movement,
                        category: classification.category,
                        paymentMethod: {
                            id: payment.paymentMethod.id,
                            name: payment.paymentMethod.name,
                            // methodType is the immutable snapshot persisted with
                            // the payment; the catalog name is only its current label.
                            type: payment.methodType,
                            source: classification.paymentDomain === 'POS'
                                ? 'PAYMENT' as const
                                : 'CATERING_PAYMENT' as const,
                            nameSource: 'CURRENT_PAYMENT_METHOD_CATALOG' as const
                        }
                    };
                }

                return {
                    ...movement,
                    category: classification.category,
                    paymentMethod: {
                        id: null,
                        name: 'Referencia de pago no conciliada',
                        type: null,
                        source: 'UNRESOLVED_REFERENCE' as const,
                        nameSource: 'NOT_APPLICABLE' as const
                    }
                };
            }

            const isManual = classification.category === 'MANUAL_INCOME'
                || classification.category === 'MANUAL_OUTFLOW';
            return {
                ...movement,
                category: classification.category,
                paymentMethod: {
                    id: null,
                    name: isManual ? 'Movimiento manual de caja' : 'Movimiento no clasificado',
                    type: null,
                    source: isManual
                        ? 'MANUAL_CASH_MOVEMENT' as const
                        : 'UNRESOLVED_REFERENCE' as const,
                    nameSource: 'NOT_APPLICABLE' as const
                }
            };
        });
    }
}
