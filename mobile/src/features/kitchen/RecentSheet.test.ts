import { describe, expect, it } from 'vitest';
import { mergeRecent } from './RecentSheet';
import type { KitchenBatch } from './kitchenTypes';

const mk = (id: number, releasedAt: string): KitchenBatch => ({
    id, kitchenBatchId: 1, status: 'READY', orderType: 'DINE_IN', createdAt: releasedAt, items: [], kitchenReleasedAt: releasedAt,
});
const at = (min: number) => new Date(Date.UTC(2026, 10, 21, 10, min)).toISOString();

describe('mergeRecent', () => {
    it('merges server and local, dedupes by key, sorts newest release first and takes 10', () => {
        const local = Array.from({ length: 10 }, (_, i) => mk(100 + i, at(i))); // 00..09
        const server = [mk(1, at(30)), mk(2, at(20)), mk(100, at(0)), mk(3, at(15))];
        const out = mergeRecent(local, server);
        expect(out).toHaveLength(10);
        expect(out.slice(0, 3).map((b) => b.id)).toEqual([1, 2, 3]); // server releases beat old local ones
        expect(new Set(out.map((b) => `${b.id}:${b.kitchenBatchId}`)).size).toBe(10);
        const times = out.map((b) => new Date(b.kitchenReleasedAt!).getTime());
        expect([...times].sort((a, b) => b - a)).toEqual(times);
    });
});
