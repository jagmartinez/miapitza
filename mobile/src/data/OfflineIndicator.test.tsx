import { configure, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Lazy chunks and a busy machine make the 1 s default flaky (the full suite runs ~100 files in parallel).
configure({ asyncUtilTimeout: 5000 });
import { createOfflineQueue, STALE_AFTER_MS } from './offlineQueue';
import { OfflineIndicator } from './OfflineIndicator';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    let clock = 1_000_000;
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline, now: () => clock });
    return { ...env, queue, advance: (ms: number) => (clock += ms) };
}
const add = (label: string) => ({ url: '/orders/5/items', method: 'POST' as const, data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM' as const, meta: { label } });

afterEach(cleanup);

describe('offline indicator list (ruling c)', () => {
    it('opens a list of the pending items with Reintentar and Descartar', async () => {
        const { queue, setOnline, db } = await setup();
        setOnline(false);
        await queue.enqueue(add('2 × Coca'));
        await queue.enqueue(add('1 × Pizza'));
        render(<OfflineIndicator queue={queue} />);
        fireEvent.click(await screen.findByRole('button', { name: /pendientes/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Pendientes de sincronizar' });
        expect(await within(dialog).findByText('2 × Coca')).toBeInTheDocument();
        expect(within(dialog).getByText('1 × Pizza')).toBeInTheDocument();
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Descartar' })[0]);
        await waitFor(() => expect(within(dialog).queryByText('2 × Coca')).toBeNull());
        expect(await db.syncQueue.count()).toBe(1);
    });

    it('a failed item shows why, and Reintentar sends it again', async () => {
        const { queue, advance, seen } = await setup();
        await queue.enqueue({ ...add('3 × Fanta'), idempotencyKey: 'k-old' });
        advance(STALE_AFTER_MS + 5);
        await queue.process();
        render(<OfflineIndicator queue={queue} />);
        fireEvent.click(await screen.findByRole('button', { name: /sin sincronizar/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Pendientes de sincronizar' });
        expect(await within(dialog).findByText('3 × Fanta')).toBeInTheDocument();
        expect(within(dialog).getByText(/más de 12 h/)).toBeInTheDocument();
        expect(seen).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(seen).toHaveLength(1));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // nothing left: the list closes itself
    });

    it('renders nothing when there is nothing to sync', async () => {
        const { queue } = await setup();
        const { container } = render(<OfflineIndicator queue={queue} />);
        expect(container).toBeEmptyDOMElement();
    });
});
