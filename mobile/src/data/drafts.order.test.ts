import { createDrafts } from './drafts';
import { makeEnv } from './testkit';

const items = (id: number) => ({ items: [{ menuItemId: id, quantity: 1 }] });

describe('drafts keyed by order (Fable I7, ruling d)', () => {
    it('an order draft and the table fallback are separate, and two orders of one table never share', async () => {
        const drafts = createDrafts(makeEnv().db);
        await drafts.set('1:1', { orderId: 10 }, items(1));
        await drafts.set('1:1', { orderId: 11 }, items(2)); // the next party on the same table
        await drafts.set('1:1', { tableId: 5 }, items(3));
        expect((await drafts.get('1:1', { orderId: 10 }))?.items[0].menuItemId).toBe(1);
        expect((await drafts.get('1:1', { orderId: 11 }))?.items[0].menuItemId).toBe(2);
        expect((await drafts.get('1:1', { tableId: 5 }))?.items[0].menuItemId).toBe(3);
        expect((await drafts.get('1:1', 5))?.items[0].menuItemId).toBe(3); // a bare number is the table fallback
        await drafts.clear('1:1', { orderId: 10 });
        expect(await drafts.get('1:1', { orderId: 10 })).toBeNull();
        expect(await drafts.get('1:1', { orderId: 11 })).not.toBeNull();
    });

    it('a draft older than 24 h is gone: not returned and deleted', async () => {
        const env = makeEnv();
        let t = 1_000_000;
        const drafts = createDrafts(env.db, () => t);
        await drafts.set('1:1', { orderId: 10 }, items(1));
        t += 23 * 3_600_000;
        expect(await drafts.get('1:1', { orderId: 10 })).not.toBeNull();
        t += 2 * 3_600_000;
        expect(await drafts.get('1:1', { orderId: 10 })).toBeNull();
        expect(await env.db.drafts.count()).toBe(0);
    });

    it('purgeExpired removes every expired draft and keeps the rest', async () => {
        const env = makeEnv();
        let t = 1_000_000;
        const drafts = createDrafts(env.db, () => t);
        await drafts.set('1:1', { orderId: 10 }, items(1));
        t += 25 * 3_600_000;
        await drafts.set('1:2', { tableId: 3 }, items(2));
        await drafts.purgeExpired();
        expect((await env.db.drafts.toArray()).map((r) => r.ownerKey)).toEqual(['1:2']);
    });

    it('adopt moves the table fallback into the order only when it was written after the order existed', async () => {
        const env = makeEnv();
        const t = 1_000_000;
        const drafts = createDrafts(env.db, () => t);
        await drafts.set('1:1', { tableId: 5 }, items(7)); // written at t
        // a NEW order opened later on the same table: the leftover is not its draft
        expect(await drafts.adopt('1:1', 5, 12, t + 60_000)).toBeNull();
        expect(await drafts.get('1:1', { orderId: 12 })).toBeNull();
        expect(await drafts.get('1:1', { tableId: 5 })).not.toBeNull(); // untouched (it expires on its own)
        // the order that already existed when the draft was written: it is that order's draft
        expect((await drafts.adopt('1:1', 5, 13, t - 60_000))?.items[0].menuItemId).toBe(7);
        expect((await drafts.get('1:1', { orderId: 13 }))?.items[0].menuItemId).toBe(7);
        expect(await drafts.get('1:1', { tableId: 5 })).toBeNull(); // moved, not copied
    });

    it('the notBefore rule also guards a read of the table fallback (a temp order created now)', async () => {
        const env = makeEnv();
        const t = 1_000_000;
        const drafts = createDrafts(env.db, () => t);
        await drafts.set('1:1', { tableId: 5 }, items(7));
        expect(await drafts.get('1:1', { tableId: 5 }, { notBefore: t + 1 })).toBeNull();
        expect(await drafts.get('1:1', { tableId: 5 }, { notBefore: t })).not.toBeNull();
    });
});
