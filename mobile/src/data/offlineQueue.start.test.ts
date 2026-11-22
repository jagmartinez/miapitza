import { createOfflineQueue } from './offlineQueue';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    return { ...env, queue };
}

describe('offlineQueue.start is reference counted', () => {
    it('stays attached while another starter is still up', async () => {
        const { queue } = await setup();
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const stopWaiter = queue.start();
        const stopInventory = queue.start();
        stopInventory();
        expect(remove.mock.calls.filter((c) => c[0] === 'online')).toHaveLength(0);
        stopWaiter();
        expect(remove.mock.calls.filter((c) => c[0] === 'online')).toHaveLength(1);
        expect(add.mock.calls.filter((c) => c[0] === 'online')).toHaveLength(1);
        add.mockRestore();
        remove.mockRestore();
    });

    it('a stop function is idempotent and still replays on reconnect after a nested start/stop', async () => {
        const { queue, seen, db } = await setup();
        const stopWaiter = queue.start();
        const stopInventory = queue.start();
        stopInventory();
        stopInventory(); // double stop must not release the waiter's reference
        await queue.enqueue({ url: '/orders/5/items', method: 'POST', data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', idempotencyKey: 'k1' });
        await db.syncQueue.toCollection().modify({ status: 'pending', networkFailures: 1, nextAttemptAt: Date.now() + 60_000 });
        const before = seen.length;
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(before));
        stopWaiter();
    });
});
