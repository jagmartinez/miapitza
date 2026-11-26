import type { MobileDB } from './cache';
import type { PlanRow } from './types';

const MAX_AGE_MS = 24 * 60 * 60_000;
const idOf = (ownerKey: string, orderId: number) => `${ownerKey}|${orderId}`;

/**
 * Owner-scoped store of the in-progress payment plan per order. Storage failures never block a payment:
 * a failed read is "no plan", a failed write is ignored (the plan then only lives in memory).
 */
export function createPaymentPlans(db: MobileDB, now: () => number = Date.now) {
    return {
        async load(ownerKey: string, orderId: number): Promise<PlanRow | null> {
            try {
                const row = await db.paymentPlans.get(idOf(ownerKey, orderId));
                if (!row) return null;
                if (row.timestamp < now() - MAX_AGE_MS) {
                    await db.paymentPlans.delete(row.id);
                    return null;
                }
                return row;
            } catch {
                return null;
            }
        },
        async save(ownerKey: string, row: Omit<PlanRow, 'id' | 'ownerKey' | 'timestamp'>): Promise<void> {
            try {
                await db.paymentPlans.put({ ...row, id: idOf(ownerKey, row.orderId), ownerKey, timestamp: now() });
            } catch {
                /* memory only */
            }
        },
        async clear(ownerKey: string, orderId: number): Promise<void> {
            try {
                await db.paymentPlans.delete(idOf(ownerKey, orderId));
            } catch {
                /* nothing to clear */
            }
        },
    };
}

export type PaymentPlans = ReturnType<typeof createPaymentPlans>;
