import { createDrafts } from './drafts';
import { makeEnv } from './testkit';

describe('drafts', () => {
    it('drafts are isolated per user and table', async () => {
        const drafts = createDrafts(makeEnv().db);
        await drafts.set(1, 10, { items: [{ menuItemId: 1, quantity: 2 }] });
        await drafts.set(2, 10, { items: [{ menuItemId: 9, quantity: 1 }] });
        await drafts.set(1, 11, { items: [] });
        expect((await drafts.get(1, 10))?.items).toEqual([{ menuItemId: 1, quantity: 2 }]);
        expect((await drafts.get(2, 10))?.items).toEqual([{ menuItemId: 9, quantity: 1 }]);
        await drafts.clear(1, 10);
        expect(await drafts.get(1, 10)).toBeNull();
        expect(await drafts.get(2, 10)).not.toBeNull();
        expect(await drafts.get(1, 11)).not.toBeNull();
    });

    it('never stores tokens', async () => {
        const env = makeEnv();
        const drafts = createDrafts(env.db);
        await drafts.set(1, 1, { items: [], token: 'secret', nested: { Authorization: 'Bearer x', ok: 1 } } as never);
        const raw = JSON.stringify(await env.db.drafts.toArray());
        expect(raw).not.toMatch(/secret|Bearer/);
        expect(raw).toContain('"ok":1');
    });
});
