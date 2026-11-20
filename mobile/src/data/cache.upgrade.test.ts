import { MobileDB, MOBILE_DB_VERSION } from './cache';
import type { DraftRow, SyncItem } from './types';

const OWNER = '1:7';
const queueRow = (n: number, over: Partial<SyncItem> = {}): SyncItem => ({
    url: `/orders/${n}/items`,
    method: 'POST',
    data: { menuItemId: n, quantity: 1 },
    timestamp: n,
    operationType: 'ADD_ORDER_ITEM',
    status: 'pending',
    retryCount: 0,
    ownerKey: OWNER,
    idempotencyKey: `k${n}`,
    ...over,
});

let counter = 0;
const nameOf = () => `upgrade-${++counter}-${Date.now()}`;

describe('Dexie upgrades never lose queued work', () => {
    it('declares every version in order, and the latest is the one the app opens', () => {
        expect(MOBILE_DB_VERSION).toBeGreaterThanOrEqual(5);
    });

    it('walks v1 -> latest one version at a time with queue rows present: every row survives, with its key, status and owner', async () => {
        const name = nameOf();
        for (let v = 1; v <= MOBILE_DB_VERSION; v += 1) {
            const db = new MobileDB(name, { upTo: v });
            await db.open();
            // the queue as the app of that version would have left it: one of each status, and a failed one with its error
            await db.syncQueue.add(queueRow(v * 10, { status: 'pending' }));
            await db.syncQueue.add(queueRow(v * 10 + 1, { status: 'blocked', dependencyKey: 'order-1-aaaaaaaa' }));
            await db.syncQueue.add(queueRow(v * 10 + 2, { status: 'failed', lastError: `boom ${v}`, retryCount: 5 }));
            db.close();
        }
        const latest = new MobileDB(name);
        await latest.open();
        const rows = await latest.syncQueue.toArray();
        expect(rows).toHaveLength(MOBILE_DB_VERSION * 3);
        for (let v = 1; v <= MOBILE_DB_VERSION; v += 1) {
            const mine = rows.filter((r) => r.timestamp >= v * 10 && r.timestamp <= v * 10 + 2).sort((a, b) => a.timestamp - b.timestamp);
            expect(mine.map((r) => [r.idempotencyKey, r.status, r.ownerKey])).toEqual([
                [`k${v * 10}`, 'pending', OWNER],
                [`k${v * 10 + 1}`, 'blocked', OWNER],
                [`k${v * 10 + 2}`, 'failed', OWNER],
            ]);
            expect(mine[2].lastError).toBe(`boom ${v}`);
            expect(mine[1].dependencyKey).toBe('order-1-aaaaaaaa');
        }
        // the indexes the queue relies on still answer after the last upgrade
        expect(await latest.syncQueue.where('ownerKey').equals(OWNER).count()).toBe(MOBILE_DB_VERSION * 3);
        expect(await latest.syncQueue.where('status').equals('failed').count()).toBe(MOBILE_DB_VERSION);
        expect((await latest.syncQueue.where('dependencyKey').equals('order-1-aaaaaaaa').toArray()).length).toBe(MOBILE_DB_VERSION);
        latest.close();
    });

    it('a jump straight from v1 to latest (an app that skipped releases) keeps the queue too', async () => {
        const name = nameOf();
        const old = new MobileDB(name, { upTo: 1 });
        await old.open();
        await old.syncQueue.bulkAdd([queueRow(1), queueRow(2, { status: 'failed', lastError: 'x' })]);
        old.close();
        const latest = new MobileDB(name);
        await latest.open();
        expect((await latest.syncQueue.orderBy('timestamp').toArray()).map((r) => [r.idempotencyKey, r.status])).toEqual([
            ['k1', 'pending'],
            ['k2', 'failed'],
        ]);
        latest.close();
    });

    it('drafts: v1 rows (keyed by user only, unreleased) are dropped, and table-keyed rows are rekeyed to the table fallback', async () => {
        const name = nameOf();
        const v1 = new MobileDB(name, { upTo: 1 });
        await v1.open();
        await (v1.drafts as unknown as { add: (row: unknown) => Promise<unknown> }).add({ id: '7:3', userId: 7, data: { items: [] }, updatedAt: Date.now() });
        v1.close();
        const v4 = new MobileDB(name, { upTo: 4 });
        await v4.open();
        const row = (tableId: number, updatedAt: number): DraftRow => ({ id: `${OWNER}:${tableId}`, ownerKey: OWNER, tableId, data: { items: [{ menuItemId: 1, quantity: 1 }] }, updatedAt });
        await v4.drafts.bulkAdd([row(3, Date.now()), row(4, Date.now() - 30 * 3_600_000)]);
        v4.close();
        const latest = new MobileDB(name);
        await latest.open();
        const ids = (await latest.drafts.toArray()).map((r) => r.id);
        expect(ids).toEqual([`${OWNER}:t:3`]); // v1 row gone; fresh one rekeyed; the 30 h old one expired
        latest.close();
    });
});

describe('v5 upgrade only rekeys legacy rows', () => {
    it('a row already in the new format keeps its id', async () => {
        const name = nameOf();
        const v4 = new MobileDB(name, { upTo: 4 });
        await v4.open();
        const row = (id: string, tableId: number): DraftRow => ({ id, ownerKey: OWNER, tableId, data: { items: [] }, updatedAt: Date.now() });
        await v4.drafts.bulkAdd([row(`${OWNER}:o:12`, 3), row(`${OWNER}:4`, 4)]);
        v4.close();
        const latest = new MobileDB(name);
        await latest.open();
        expect((await latest.drafts.toArray()).map((r) => r.id).sort()).toEqual([`${OWNER}:o:12`, `${OWNER}:t:4`]);
        latest.close();
    });
});
