import type { MobileDB } from './cache';
import { guarded } from './storage';
import type { DraftData } from './types';

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

const idOf = (ownerKey: string, tableId: number) => `${ownerKey}:${tableId}`;

/** Drafts are keyed by owner (`companyId:userId`) and table. Storage failures surface as StorageError. */
export function createDrafts(db: MobileDB, now: () => number = Date.now) {
    return {
        async get(ownerKey: string, tableId: number): Promise<DraftData | null> {
            return guarded('drafts', 'get', async () => (await db.drafts.get(idOf(ownerKey, tableId)))?.data ?? null);
        },
        async set(ownerKey: string, tableId: number, data: DraftData): Promise<void> {
            await guarded('drafts', 'set', () =>
                db.drafts.put({ id: idOf(ownerKey, tableId), ownerKey, tableId, data: sanitize(data) as DraftData, updatedAt: now() }),
            );
        },
        async clear(ownerKey: string, tableId: number): Promise<void> {
            await guarded('drafts', 'clear', () => db.drafts.delete(idOf(ownerKey, tableId)));
        },
    };
}

export type Drafts = ReturnType<typeof createDrafts>;
