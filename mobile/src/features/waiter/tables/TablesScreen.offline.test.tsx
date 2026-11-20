import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createCache } from '../../../data/cache';
import { createOfflineQueue } from '../../../data/offlineQueue';
import { makeEnv, sessionFor } from '../../../data/testkit';
import { createWaiterApi } from '../../../data/waiterApi';
import { TablesScreen } from './TablesScreen';
import { makeApi, makeRealtime, userSession } from './testkit';

async function world() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(7)); // the tablet user; baseSession of the test helpers is user 7 / company 1
    env.setOnline(false);
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const real = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    const api = makeApi({ createOrder: real.createOrder as never });
    const onOpenOrder = vi.fn();
    render(
        <TablesScreen
            session={userSession(['orders.view', 'orders.create'])}
            api={api}
            realtime={makeRealtime()}
            queue={queue}
            invalidate={vi.fn().mockResolvedValue(undefined)}
            onOpenOrder={onOpenOrder}
            onSwitchUser={vi.fn()}
        />,
    );
    return { env, queue, real, api, onOpenOrder };
}

afterEach(cleanup);

describe('final review: an order opened offline shows on the plan (Opus I3)', () => {
    it('the table turns occupied by the temp order, and tapping it reopens that order', async () => {
        const { real, onOpenOrder } = await world();
        const tile = await screen.findByTestId('tile-1');
        expect(tile).toHaveAttribute('data-state', 'free');
        const created = (await real.createOrder({ tableId: 1, guests: 2, orderType: 'DINE_IN' })) as { entityTempId: string };
        await waitFor(() => expect(screen.getByTestId('tile-1')).toHaveAttribute('data-state', 'occupied'));
        expect(screen.getByTestId('tile-1')).toHaveTextContent('Sin sincronizar');
        fireEvent.click(screen.getByTestId('tile-1'));
        expect(screen.queryByRole('dialog')).toBeNull(); // no "open table" sheet: it is not free
        expect(onOpenOrder).toHaveBeenCalledWith(created.entityTempId, undefined, 1, '1');
    });

    it('a second open of that table (e.g. a stale sheet) lands on the temp order instead of creating another', async () => {
        const { real, queue, api, onOpenOrder } = await world();
        const first = (await real.createOrder({ tableId: 5, guests: 2, orderType: 'DINE_IN' })) as { entityTempId: string };
        // Stale tile: the screen has not noticed yet, so the open sheet is still reachable through the api guard.
        await expect(api.createOrder({ tableId: 5, guests: 4, orderType: 'DINE_IN' })).rejects.toMatchObject({ tempId: first.entityTempId });
        expect(await queue.pendingCreates()).toHaveLength(1);
        expect(onOpenOrder).not.toHaveBeenCalled();
    });
});
