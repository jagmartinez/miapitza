import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createOfflineQueue } from '../../../data/offlineQueue';
import { makeEnv, sessionFor } from '../../../data/testkit';
import { OrderScreen } from './OrderScreen';
import { makeApi, makeDrafts, makeRealtime, userSession } from './testkit';

async function world(orderId: number | string) {
    const env = makeEnv();
    await env.sessions.save(sessionFor(7));
    env.setOnline(false);
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = makeApi();
    render(<OrderScreen session={userSession()} api={api} drafts={makeDrafts()} realtime={makeRealtime()} queue={queue} orderId={orderId} tableId={5} tableNumber="5" intent="view" invalidate={vi.fn()} onBack={vi.fn()} />);
    return { env, queue, api };
}

afterEach(cleanup);

describe('final review: lines queued offline stay on the ticket (Fable I5)', () => {
    it('shows each queued line, marked "pendiente de sincronizar", and counts it in the order', async () => {
        const { queue } = await world(102);
        await queue.enqueue({ url: '/orders/102/items', method: 'POST', data: { menuItemId: 2, quantity: 2, notes: 'sin hielo' }, operationType: 'ADD_ORDER_ITEM', meta: { name: 'Cola', unitPrice: 30, modifierNames: [] } });
        const ticket = screen.getByRole('region', { name: 'Ticket' });
        const row = await within(ticket).findByText('Cola');
        expect(row).toBeInTheDocument();
        expect(within(ticket).getByText('Pendiente de sincronizar')).toBeInTheDocument();
        expect(within(ticket).getByText(/sin hielo/)).toBeInTheDocument();
        expect(within(ticket).getByText('C$ 60')).toBeInTheDocument();
    });

    it('an order that exists only in the queue shows its lines and its table number', async () => {
        const { queue } = await world('order-1700-abcd1234');
        await queue.enqueue({ url: '/orders/order-1700-abcd1234/items', method: 'POST', data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-1700-abcd1234', meta: { name: 'Pizza Margarita', unitPrice: 100 } });
        expect(await screen.findByText('Mesa 5', { selector: 'strong' })).toBeInTheDocument();
        const ticket = screen.getByRole('region', { name: 'Ticket' });
        expect(await within(ticket).findByText('Pizza Margarita')).toBeInTheDocument();
        expect(within(ticket).getByText('Pendiente de sincronizar')).toBeInTheDocument();
    });

    it('a line that gave up shows as failed, not as pending', async () => {
        const { queue, env } = await world(102);
        const item = await queue.enqueue({ url: '/orders/102/items', method: 'POST', data: { menuItemId: 2, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', meta: { name: 'Cola', unitPrice: 30 } });
        await env.db.syncQueue.update(item.id!, { status: 'failed', lastError: 'x' });
        await queue.listItems();
        queue.notifySessionChanged();
        const ticket = screen.getByRole('region', { name: 'Ticket' });
        await waitFor(() => expect(within(ticket).getByText('No se pudo sincronizar')).toBeInTheDocument());
    });
});
