import { appEvents } from '../core/events';
import { createDrafts } from './drafts';
import { StorageError } from './storage';
import { makeEnv } from './testkit';

describe('drafts', () => {
    it('drafts are isolated per user, company and table', async () => {
        const drafts = createDrafts(makeEnv().db);
        await drafts.set('1:1', 10, { items: [{ menuItemId: 1, quantity: 2 }] });
        await drafts.set('1:2', 10, { items: [{ menuItemId: 9, quantity: 1 }] });
        await drafts.set('2:1', 10, { items: [{ menuItemId: 5, quantity: 1 }] }); // same user id, other company
        await drafts.set('1:1', 11, { items: [] });
        expect((await drafts.get('1:1', 10))?.items).toEqual([{ menuItemId: 1, quantity: 2 }]);
        expect((await drafts.get('1:2', 10))?.items).toEqual([{ menuItemId: 9, quantity: 1 }]);
        expect((await drafts.get('2:1', 10))?.items).toEqual([{ menuItemId: 5, quantity: 1 }]);
        await drafts.clear('1:1', 10);
        expect(await drafts.get('1:1', 10)).toBeNull();
        expect(await drafts.get('1:2', 10)).not.toBeNull();
        expect(await drafts.get('1:1', 11)).not.toBeNull();
    });

    it('never stores tokens', async () => {
        const env = makeEnv();
        const drafts = createDrafts(env.db);
        await drafts.set('1:1', 1, { items: [], token: 'secret', nested: { Authorization: 'Bearer x', ok: 1 } } as never);
        const raw = JSON.stringify(await env.db.drafts.toArray());
        expect(raw).not.toMatch(/secret|Bearer/);
        expect(raw).toContain('"ok":1');
    });

    it('storage failures become a StorageError and are reported', async () => {
        const env = makeEnv();
        const drafts = createDrafts(env.db);
        vi.spyOn(env.db.drafts, 'put').mockRejectedValue(new Error('QuotaExceededError'));
        const fn = vi.fn();
        const off = appEvents.on('storage-error', fn);
        await expect(drafts.set('1:1', 1, { items: [] })).rejects.toBeInstanceOf(StorageError);
        off();
        expect(fn).toHaveBeenCalledWith(expect.objectContaining({ scope: 'drafts', op: 'set' }));
    });
});
