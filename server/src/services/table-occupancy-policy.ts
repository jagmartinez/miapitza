import { Prisma } from '@prisma/client';

export const TABLE_OPERATIONAL_ORDER_STATUSES = [
    'OPEN',
    'SENT_TO_KITCHEN',
    'IN_PREPARATION',
    'READY',
] as const;

export type TableOperationalOrderStatus = typeof TABLE_OPERATIONAL_ORDER_STATUSES[number];

type FiscalTableClosure = {
    invoiceNumber: string | null;
    invoiceSnapshot: Prisma.JsonValue | null;
    invoiceFiscalStatus: string;
};

/**
 * Fiscal issuance closes the table account without claiming that food was
 * delivered. The immutable number + snapshot are the durable fact; subsequent
 * payment reversals and fiscal counterdocuments must not reopen the table.
 */
export function isTableAccountClosedByInvoice(order: FiscalTableClosure): boolean {
    return Boolean(order.invoiceNumber?.trim())
        && order.invoiceSnapshot !== null
        && order.invoiceFiscalStatus !== 'NOT_ISSUED';
}

function fiscalTableClosureWhere(): Prisma.OrderWhereInput {
    return {
        invoiceNumber: { not: null },
        invoiceSnapshot: { not: Prisma.DbNull },
        invoiceFiscalStatus: { not: 'NOT_ISSUED' },
    };
}

/** Operational order that still owns a table account. */
export function tableOperationalOrderWhere(): Prisma.OrderWhereInput {
    return {
        status: { in: [...TABLE_OPERATIONAL_ORDER_STATUSES] },
        NOT: fiscalTableClosureWhere(),
    };
}

/**
 * Any order that keeps a table occupied. A delivered/unpaid legacy account
 * remains open only when it has not crossed the immutable invoice boundary.
 */
export function tableOpenAccountWhere(): Prisma.OrderWhereInput {
    return {
        AND: [
            {
                OR: [
                    { status: { in: [...TABLE_OPERATIONAL_ORDER_STATUSES] } },
                    { status: 'DELIVERED', financialStatus: { not: 'PAID' } },
                ],
            },
            { NOT: fiscalTableClosureWhere() },
        ],
    };
}
