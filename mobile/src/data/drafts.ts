import type { MobileDB } from './cache';
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

const idOf = (userId: number, tableId: number) => `${userId}:${tableId}`;

export function createDrafts(db: MobileDB, now: () => number = Date.now) {
    return {
        async get(userId: number, tableId: number): Promise<DraftData | null> {
            return (await db.drafts.get(idOf(userId, tableId)))?.data ?? null;
        },
        async set(userId: number, tableId: number, data: DraftData): Promise<void> {
            await db.drafts.put({ id: idOf(userId, tableId), userId, tableId, data: sanitize(data) as DraftData, updatedAt: now() });
        },
        async clear(userId: number, tableId: number): Promise<void> {
            await db.drafts.delete(idOf(userId, tableId));
        },
    };
}

export type Drafts = ReturnType<typeof createDrafts>;
