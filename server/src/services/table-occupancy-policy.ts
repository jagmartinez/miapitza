import { Prisma } from '@prisma/client';

export const TABLE_OPERATIONAL_ORDER_STATUSES = [
    'OPEN',
    'SENT_TO_KITCHEN',
    'IN_PREPARATION',
    'READY',
] as const;

export type TableOperationalOrderStatus = typeof TABLE_OPERATIONAL_ORDER_STATUSES[number];

export const TABLE_ACCOUNT_HOLDING_STATUSES = [
    ...TABLE_OPERATIONAL_ORDER_STATUSES,
    'DELIVERED',
] as const;

type TableAccountOrder = {
    status: string;
    financialStatus: string;
};

/**
 * A fiscal document freezes price/customer data but does not settle the debt.
 * The account keeps its table until payment is complete or the order reaches a
 * terminal cancellation. Payment reversal therefore reopens the same account.
 */
export function doesOrderHoldTableAccount(order: TableAccountOrder): boolean {
    return order.financialStatus !== 'PAID'
        && TABLE_ACCOUNT_HOLDING_STATUSES.includes(
            order.status as typeof TABLE_ACCOUNT_HOLDING_STATUSES[number],
        );
}

/** Operational order that still owns a table account. */
export function tableOperationalOrderWhere(): Prisma.OrderWhereInput {
    return {
        status: { in: [...TABLE_OPERATIONAL_ORDER_STATUSES] },
        financialStatus: { not: 'PAID' },
    };
}

/**
 * Any non-cancelled, non-settled account that keeps a table occupied. Delivered
 * legacy accounts remain visible until their financial balance is settled.
 */
export function tableOpenAccountWhere(): Prisma.OrderWhereInput {
    return {
        status: { in: [...TABLE_ACCOUNT_HOLDING_STATUSES] },
        financialStatus: { not: 'PAID' },
    };
}
