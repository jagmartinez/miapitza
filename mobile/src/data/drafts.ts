import type { MobileDB } from './cache';
import { guarded } from './storage';
import type { DraftData, DraftRow } from './types';

/** Credential-looking keys are dropped at any depth: a draft is cart data, never auth. */
const FORBIDDEN_KEY = /token|authorization|bearer|password|secret|^pin$/i;

function sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (!FORBIDDEN_KEY.test(k)) out[k] = sanitize(v);
        }
        return out;
    }
    return value;
}

/** Unsent lines are cart data for a service shift: a draft untouched for this long is gone. */
export const DRAFT_TTL_MS = 24 * 60 * 60_000;

/**
 * What a draft belongs to. Once an order exists it is `{ orderId }`: the next party on the same table never inherits it.
 * `{ tableId }` (or a bare table number) is the fallback for a table with no order yet, or an order that only lives in
 * the offline queue.
 */
export type DraftRef = number | { tableId: number } | { orderId: number };

const idOf = (ownerKey: string, ref: DraftRef) => {
    if (typeof ref === 'number') return `${ownerKey}:t:${ref}`;
    return 'orderId' in ref ? `${ownerKey}:o:${ref.orderId}` : `${ownerKey}:t:${ref.tableId}`;
};

/** Drafts are keyed by owner (`companyId:userId`) and order (or table), and expire after 24 h. Storage failures surface as StorageError. */
export function createDrafts(db: MobileDB, now: () => number = Date.now) {
    const live = (row: DraftRow | undefined): DraftRow | null => (row && row.updatedAt >= now() - DRAFT_TTL_MS ? row : null);

    return {
        /** `notBefore`: ignore a draft written before that moment (it belongs to an earlier order on the table). */
        async get(ownerKey: string, ref: DraftRef, opts: { notBefore?: number } = {}): Promise<DraftData | null> {
            return guarded('drafts', 'get', async () => {
                const id = idOf(ownerKey, ref);
                const row = await db.drafts.get(id);
                const fresh = live(row);
                if (row && !fresh) await db.drafts.delete(id);
                if (!fresh || (opts.notBefore !== undefined && fresh.updatedAt < opts.notBefore)) return null;
                return fresh.data;
            });
        },
        async set(ownerKey: string, ref: DraftRef, data: DraftData, tableId?: number): Promise<void> {
            const table = typeof ref === 'number' ? ref : 'tableId' in ref ? ref.tableId : (tableId ?? null);
            const orderId = typeof ref === 'object' && 'orderId' in ref ? ref.orderId : null;
            await guarded('drafts', 'set', () => db.drafts.put({ id: idOf(ownerKey, ref), ownerKey, tableId: table, orderId, data: sanitize(data) as DraftData, updatedAt: now() }));
        },
        async clear(ownerKey: string, ref: DraftRef): Promise<void> {
            await guarded('drafts', 'clear', () => db.drafts.delete(idOf(ownerKey, ref)));
        },
        /**
         * The table's fallback draft becomes the order's, but only if it was written after the order existed (`notBefore` =
         * the order's creation): a leftover from an earlier party is not this order's draft. Moved, not copied.
         */
        async adopt(ownerKey: string, tableId: number, orderId: number, notBefore: number): Promise<DraftData | null> {
            return guarded('drafts', 'adopt', () =>
                db.transaction('rw', db.drafts, async () => {
                    const from = idOf(ownerKey, { tableId });
                    const row = live(await db.drafts.get(from));
                    if (!row || row.updatedAt < notBefore) return null;
                    await db.drafts.put({ ...row, id: idOf(ownerKey, { orderId }), tableId, orderId });
                    await db.drafts.delete(from);
                    return row.data;
                }),
            );
        },
        /** Start-up sweep: expired drafts of every owner. */
        async purgeExpired(): Promise<void> {
            await guarded('drafts', 'purge', () => db.drafts.where('updatedAt').below(now() - DRAFT_TTL_MS).delete());
        },
    };
}

export type Drafts = ReturnType<typeof createDrafts>;
