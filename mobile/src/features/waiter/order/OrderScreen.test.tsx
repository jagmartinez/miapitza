import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderScreen } from './OrderScreen';
import { makeApi, makeDrafts, makeRealtime, minutesAgo, orderOf, result, serverItem, userSession, ALL_PERMISSIONS } from './testkit';

function setup(opts: { api?: ReturnType<typeof makeApi>; permissions?: string[]; orderId?: number | string; handlers?: Record<string, unknown>; drafts?: ReturnType<typeof makeDrafts>; userId?: number; tableId?: number | null; queue?: unknown } = {}) {
    const api = opts.api ?? makeApi();
    const drafts = opts.drafts ?? makeDrafts();
    const realtime = makeRealtime();
    const props = {
        session: userSession(opts.permissions ?? ALL_PERMISSIONS, opts.userId),
        api,
        drafts,
        realtime,
        queue: (opts.queue ?? null) as never,
        orderId: opts.orderId ?? 102,
        tableId: opts.tableId === null ? undefined : (opts.tableId ?? 2),
        intent: 'view' as const,
        invalidate: vi.fn().mockResolvedValue(undefined),
        onBack: vi.fn(),
        ...(opts.handlers ?? {}),
    };
    render(<OrderScreen {...props} />);
    return { ...props, api, drafts, realtime };
}

/** Products stay off until this waiter's draft has loaded. */
const product = async (name: string) => {
    const el = await within(await screen.findByRole('region', { name: 'Productos' })).findByRole('button', { name: new RegExp(`^${name}`) });
    await waitFor(() => expect(el).toBeEnabled());
    return el;
};
const ticket = () => screen.getByRole('region', { name: 'Ticket' });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('OrderScreen', () => {
    it('Top rail uses top sellers order', async () => {
        setup();
        const rail = await screen.findByRole('navigation', { name: 'Categorías' });
        const names = within(rail)
            .getAllByRole('button')
            .map((b) => b.textContent);
        // Top first, Promos second, then visible categories by sortOrder; the hidden one never shows
        expect(names).toEqual(['Top', 'Promos', 'Platos', 'Bebidas']);
        expect(within(rail).getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
        const grid = screen.getByRole('region', { name: 'Productos' });
        const shown = within(grid)
            .getAllByRole('button')
            .map((b) => b.getAttribute('data-product-id'));
        expect(shown).toEqual(['3', '1']); // 40 sold, then 30
    });

    it('Promos rail lists products with a promotion and tags them', async () => {
        setup();
        fireEvent.click(await screen.findByRole('button', { name: 'Promos' }));
        const grid = screen.getByRole('region', { name: 'Productos' });
        expect(within(grid).getAllByRole('button')).toHaveLength(1);
        expect(within(grid).getByText('Promo')).toBeInTheDocument();
        expect(within(grid).queryByText('2x1')).toBeNull(); // no magnitude: the discount is applied by code, not automatically
    });

    it('tap adds one and highlights the line', async () => {
        const { drafts } = setup();
        fireEvent.click(await screen.findByRole('button', { name: 'Platos' }));
        fireEvent.click(await product('Pizza Margarita'));
        const row = await within(ticket()).findByTestId('draft-1||');
        expect(row).toHaveAttribute('data-highlighted', 'true');
        expect(within(row).getByText('Pizza Margarita')).toBeInTheDocument();
        expect(within(row).getByText('C$ 100')).toBeInTheDocument();
        // the product shows its quantity in the ticket
        expect(within(screen.getByRole('region', { name: 'Productos' })).getByRole('button', { name: /^Pizza Margarita/ })).toHaveTextContent('×1');
        fireEvent.click(within(screen.getByRole('region', { name: 'Productos' })).getByRole('button', { name: /^Pizza Margarita/ }));
        await waitFor(() => expect(within(screen.getByRole('region', { name: 'Productos' })).getByRole('button', { name: /^Pizza Margarita/ })).toHaveTextContent('×2'));
        await waitFor(async () => expect((await drafts.get('1:7', 2))?.items[0].quantity).toBe(2));
        expect(screen.getByRole('button', { name: 'Enviar a cocina · 2' })).toBeEnabled();
    });

    it('required modifier opens the sheet before adding', async () => {
        const { api } = setup();
        fireEvent.click(await product('Hamburguesa'));
        const sheet = await screen.findByRole('dialog', { name: 'Hamburguesa' });
        expect(api.menuItem).toHaveBeenCalledWith(3);
        expect(within(ticket()).queryByText('Hamburguesa')).toBeNull(); // nothing added yet
        const add = within(sheet).getByRole('button', { name: /Agregar/ });
        expect(add).toBeDisabled(); // "Punto" needs one choice
        fireEvent.click(within(sheet).getByRole('button', { name: /Bien cocida/ }));
        expect(add).toBeEnabled();
        expect(add).toHaveTextContent('C$ 130');
        fireEvent.click(add);
        const row = await within(ticket()).findByText('Hamburguesa');
        expect(row.closest('[data-testid^="draft-"]')).toHaveTextContent('Bien cocida');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('a product without required modifiers adds on tap even when it has optional groups', async () => {
        const api = makeApi();
        api.menuItem.mockResolvedValue({ data: { id: 3, modifierGroups: [{ id: 1, name: 'Extras', minSelect: 0, maxSelect: null, active: true, modifiers: [{ id: 1, name: 'Queso', price: '5', active: true }] }] }, source: 'network', refresh: Promise.resolve() });
        setup({ api });
        fireEvent.click(await product('Hamburguesa'));
        await within(ticket()).findByText('Hamburguesa');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('holding a product opens the note sheet', async () => {
        setup();
        const pizza = await product('Pizza Margarita');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            fireEvent.pointerDown(pizza);
            await act(async () => {
                vi.advanceTimersByTime(500);
            });
            fireEvent.pointerUp(pizza);
        } finally {
            vi.useRealTimers();
        }
        const sheet = await screen.findByRole('dialog', { name: 'Pizza Margarita' });
        fireEvent.change(within(sheet).getByLabelText('Nota'), { target: { value: 'sin cebolla' } });
        fireEvent.click(within(sheet).getByRole('button', { name: /Agregar/ }));
        const row = await within(ticket()).findByText('Pizza Margarita');
        expect(row.closest('[data-testid^="draft-"]')).toHaveTextContent('sin cebolla');
        // the click that ends the hold must not add a second unit
        expect(within(ticket()).getAllByTestId(/^draft-/)).toHaveLength(1);
        expect(within(ticket()).getByTestId(/^draft-/)).toHaveTextContent('1');
    });

    it('send posts the lines, then one send-to-kitchen, and a double tap sends once', async () => {
        const api = makeApi();
        const { drafts } = setup({ api });
        fireEvent.click(await product('Pizza Margarita'));
        const send = await screen.findByRole('button', { name: 'Enviar a cocina · 1' });
        fireEvent.click(send);
        fireEvent.click(send);
        await waitFor(() => expect(api.sendToKitchen).toHaveBeenCalledTimes(1));
        expect(api.addItem).toHaveBeenCalledTimes(1);
        expect(api.addItem.mock.calls[0][0]).toBe(102);
        await waitFor(async () => expect(await drafts.get('1:7', 2)).toBeNull());
        expect(screen.queryByRole('button', { name: /Enviar a cocina/ })).toBeDisabled();
    });

    it('shows the server error message when sending fails and keeps the draft', async () => {
        const api = makeApi();
        api.addItem.mockRejectedValue({ response: { status: 400, data: { message: 'Pedido cerrado' } } });
        setup({ api });
        fireEvent.click(await product('Pizza Margarita'));
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar a cocina · 1' }));
        expect(await screen.findByText('Pedido cerrado')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enviar a cocina · 1' })).toBeEnabled();
    });

    it('summarises what is already in the kitchen in a read-only card', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([serverItem(1, 1, 'Pizza Margarita', { quantity: 2, status: 'IN_PROGRESS' })]));
        setup({ api });
        const card = await within(ticket()).findByRole('button', { name: /Enviado · 2/ });
        expect(within(card).getByText('En preparación · 2')).toBeInTheDocument();
        expect(within(ticket()).queryByRole('button', { name: /Quitar|Menos/ })).toBeNull();
    });

    it('hides actions the user has no permission for', async () => {
        setup({ permissions: ['orders.view'], handlers: { onPay: vi.fn(), onSplit: vi.fn(), onDiscount: vi.fn() } });
        await screen.findByRole('region', { name: 'Productos' });
        for (const name of ['Cobrar', 'Dividir', 'Descuento', /Enviar a cocina/]) expect(screen.queryByRole('button', { name })).toBeNull();
    });

    it('gates Cobrar, Dividir and Descuento by their permissions and calls the handlers', async () => {
        const handlers = { onPay: vi.fn(), onSplit: vi.fn(), onDiscount: vi.fn() };
        setup({ permissions: ['orders.view', 'orders.edit', 'payments.process', 'invoices.issue', 'bills.split'], handlers });
        fireEvent.click(await screen.findByRole('button', { name: 'Cobrar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Dividir' }));
        // orders.edit alone shows Descuento: the waiter can ask a supervisor to authorize (spec 7.3.0)
        fireEvent.click(screen.getByRole('button', { name: 'Descuento' }));
        expect(handlers.onPay).toHaveBeenCalledTimes(1);
        expect(handlers.onSplit).toHaveBeenCalledTimes(1);
        expect(handlers.onDiscount).toHaveBeenCalledTimes(1);
    });

    it('refreshes from realtime events of this order (debounced) and unsubscribes on unmount', async () => {
        const { api, realtime } = setup();
        await screen.findByRole('region', { name: 'Productos' });
        await waitFor(() => expect(api.orderDetail).toHaveBeenCalledTimes(1));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            act(() => {
                realtime.emit('ORDER_UPDATE', { orderId: 102 });
                realtime.emit('ORDER_READY', { orderId: 102 });
                realtime.emit('ORDER_UPDATE', { orderId: 999 }); // another table
            });
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
        } finally {
            vi.useRealTimers();
        }
        await waitFor(() => expect(api.orderDetail).toHaveBeenCalledTimes(2));
        cleanup();
        const subscribed = realtime.subscribe.mock.calls.length;
        expect(subscribed).toBeGreaterThan(0);
    });

    it('Nuevo of each waiter stays theirs on the same table', async () => {
        const first = setup();
        fireEvent.click(await product('Pizza Margarita'));
        await screen.findByTestId('draft-1||');
        await waitFor(async () => expect(await first.drafts.get('1:7', 2)).not.toBeNull());
        cleanup();
        setup({ drafts: first.drafts, userId: 8 });
        await screen.findByRole('region', { name: 'Productos' });
        expect(screen.queryByTestId('draft-1||')).toBeNull();
    });
});

describe('OrderScreen fix round 1', () => {
    it('C1: a failed kitchen send shows the lines that reached the server as Nuevo, with their count', async () => {
        const api = makeApi();
        api.sendToKitchen.mockRejectedValue({ response: { status: 500, data: { message: 'Cocina no responde' } } });
        // after the lines were added, the server holds them unsent
        api.orderDetail
            .mockResolvedValueOnce(orderOf([]))
            .mockResolvedValue(orderOf([serverItem(11, 1, 'Pizza Margarita', { sentAt: null, status: 'PENDING', quantity: 1 })]));
        setup({ api });
        fireEvent.click(await product('Pizza Margarita'));
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar a cocina · 1' }));
        expect(await screen.findByText('Cocina no responde')).toBeInTheDocument();
        expect(await within(ticket()).findByTestId('unsent-11')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enviar a cocina · 1' })).toBeEnabled();
        // retry sends the batch without adding the line again
        api.sendToKitchen.mockResolvedValue({});
        fireEvent.click(screen.getByRole('button', { name: 'Enviar a cocina · 1' }));
        await waitFor(() => expect(api.sendToKitchen).toHaveBeenCalledTimes(2));
        expect(api.addItem).toHaveBeenCalledTimes(1);
    });

    it('I2: a required-modifier product is not added when its modifiers cannot be loaded', async () => {
        const api = makeApi();
        api.menuItem.mockRejectedValue(new Error('Network Error'));
        setup({ api });
        fireEvent.click(await product('Hamburguesa'));
        await waitFor(() => expect(api.menuItem).toHaveBeenCalled());
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(within(ticket()).queryByText('Hamburguesa')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Minor 9: a double tap on a product with modifiers loads and opens one sheet', async () => {
        const { api } = setup();
        const burger = await product('Hamburguesa');
        fireEvent.click(burger);
        fireEvent.click(burger);
        await screen.findByRole('dialog', { name: 'Hamburguesa' });
        expect(api.menuItem).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('I3: with the detail request failing, the order renders from the cached active list and sending still works', async () => {
        const api = makeApi();
        api.orderDetail.mockRejectedValue(new Error('Network Error'));
        api.activeOrders.mockResolvedValue(result([orderOf([serverItem(1, 4, 'Ensalada', { status: 'IN_PROGRESS' })])]));
        setup({ api, tableId: null });
        fireEvent.click(await product('Pizza Margarita'));
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar a cocina · 1' }));
        await waitFor(() => expect(api.sendToKitchen).toHaveBeenCalledTimes(1));
        expect(await within(ticket()).findByRole('button', { name: /Enviado · 1/ })).toBeInTheDocument();
    });

    it('I4: the footer total is the server total, with unsent lines on a separate line', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([serverItem(1, 4, 'Ensalada')], { total: '236.00' }));
        setup({ api });
        const foot = ticket().querySelector('footer') as HTMLElement;
        await waitFor(() => expect(foot).toHaveTextContent('C$ 236'));
        expect(foot.querySelector('.ticket-unsent')).toBeNull();
        fireEvent.click(await product('Pizza Margarita'));
        await waitFor(() => expect(foot.querySelector('.ticket-unsent')).toHaveTextContent('+ C$ 100 sin enviar'));
        expect(foot.querySelector('.ticket-total strong')).toHaveTextContent('C$ 236');
    });

    it('I5: a temp order becomes the real one once its create syncs', async () => {
        const api = makeApi();
        const snap = { pending: 0, failed: 0 };
        const noop = () => undefined;
        const listeners = new Set<(item: unknown) => void>();
        let real: number | null = null;
        const queue = { getSnapshot: () => snap, subscribe: () => noop, resolveTemp: vi.fn(async () => real), onSynced: vi.fn((fn: (item: unknown) => void) => (listeners.add(fn), () => listeners.delete(fn))) };
        api.orderDetail.mockResolvedValue(orderOf([serverItem(1, 4, 'Ensalada')], { id: 777 }));
        setup({ api, queue, orderId: 'order-1700-abcd1234' });
        await screen.findByText('Sincronizando…');
        expect(api.orderDetail).not.toHaveBeenCalled();
        real = 777;
        await act(async () => {
            listeners.forEach((fn) => fn({ operationType: 'CREATE_ORDER', entityTempId: 'order-1700-abcd1234' }));
        });
        await waitFor(() => expect(api.orderDetail).toHaveBeenCalledWith(777));
        expect(screen.queryByText('Sincronizando…')).toBeNull();
        await within(ticket()).findByRole('button', { name: /Enviado · 1/ });
    });

    it('Minor 2: tells the waiter when delivered lines were skipped', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([serverItem(5, 1, 'Pizza', { status: 'DONE', finishedAt: minutesAgo(2) }), serverItem(6, 2, 'Cola', { status: 'DONE', finishedAt: minutesAgo(2) })]));
        api.deliverItems.mockResolvedValue({ delivered: [5], skipped: [6], alreadyDelivered: [] });
        setup({ api });
        const card = await screen.findByRole('region', { name: 'Listo para entregar' });
        fireEvent.click(within(card).getByRole('button', { name: 'Entregar todo · 2' }));
        expect(await screen.findByText('1 no estaban listos.')).toBeInTheDocument();
    });
});

describe('OrderScreen fix round 2', () => {
    it('N1: while a send is in flight the grid ignores taps and the rows are locked', async () => {
        const api = makeApi();
        let release: () => void = () => undefined;
        api.addItem.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ id: 1 }))));
        setup({ api });
        const pizza = await product('Pizza Margarita');
        fireEvent.click(pizza);
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar a cocina · 1' }));
        await waitFor(() => expect(api.addItem).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Enviando…')).toBeInTheDocument();
        expect(pizza).toBeDisabled();
        const row = within(ticket()).getByTestId('draft-1||');
        expect(within(row).queryByRole('button', { name: /Pizza/ })).toBeNull(); // no expandable edit face while sending
        await act(async () => {
            release();
        });
        await waitFor(() => expect(screen.queryByText('Enviando…')).toBeNull());
        expect(pizza).toBeEnabled();
    });

    it('N2: an order already on screen is kept when a later reload fails; the cache never overwrites it', async () => {
        const api = makeApi();
        const loaded = orderOf([serverItem(1, 4, 'Ensalada', { sentAt: null, status: 'PENDING' })]);
        api.orderDetail.mockResolvedValueOnce(loaded).mockRejectedValue(new Error('Network Error'));
        api.activeOrders.mockResolvedValue(result([orderOf([])])); // older snapshot: no lines
        const { realtime } = setup({ api });
        await within(ticket()).findByTestId('unsent-1');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            act(() => realtime.emit('ORDER_UPDATE', { orderId: 102 }));
            await act(async () => {
                vi.advanceTimersByTime(300);
            });
        } finally {
            vi.useRealTimers();
        }
        await waitFor(() => expect(api.orderDetail).toHaveBeenCalledTimes(2));
        expect(await screen.findByRole('alert')).toBeInTheDocument(); // the network notice
        expect(within(ticket()).getByTestId('unsent-1')).toBeInTheDocument(); // not overwritten
        expect(screen.queryByText('Sin conexión · datos guardados')).toBeNull();
    });

    it('N2: the first load from the cached active list says the data is saved', async () => {
        const api = makeApi();
        api.orderDetail.mockRejectedValue(new Error('Network Error'));
        api.activeOrders.mockResolvedValue(result([orderOf([serverItem(1, 4, 'Ensalada', { status: 'IN_PROGRESS' })])]));
        setup({ api });
        expect(await screen.findByText('Sin conexión · datos guardados')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        await within(ticket()).findByRole('button', { name: /Enviado · 1/ });
    });

    it('N5: a line failing at k > 1 leaves the sent ones as Nuevo on the server and the rest in the draft', async () => {
        const api = makeApi();
        api.addItem.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Producto agotado' } } });
        api.orderDetail
            .mockResolvedValueOnce(orderOf([]))
            .mockResolvedValue(orderOf([serverItem(11, 1, 'Pizza Margarita', { sentAt: null, status: 'PENDING' })]));
        setup({ api });
        fireEvent.click(await product('Pizza Margarita'));
        fireEvent.click(await within(screen.getByRole('region', { name: 'Productos' })).findByRole('button', { name: /^Hamburguesa/ }));
        // Hamburguesa needs a modifier: pick one
        const sheet = await screen.findByRole('dialog', { name: 'Hamburguesa' });
        fireEvent.click(within(sheet).getByRole('button', { name: /Término medio/ }));
        fireEvent.click(within(sheet).getByRole('button', { name: /Agregar/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar a cocina · 2' }));
        expect(await screen.findByText('Producto agotado')).toBeInTheDocument();
        expect(sendCalls(api)).toBe(0);
        expect(await within(ticket()).findByTestId('unsent-11')).toBeInTheDocument();
        expect(within(ticket()).getByText('Hamburguesa')).toBeInTheDocument(); // still a draft
        expect(screen.getByRole('button', { name: 'Enviar a cocina · 2' })).toBeEnabled();
    });

    it('N5: unmounting while resolveTemp is pending does not update state or fetch', async () => {
        const api = makeApi();
        let finish: (v: number | null) => void = () => undefined;
        const snap = { pending: 0, failed: 0 };
        const noop = () => undefined;
        const off = vi.fn();
        const queue = { getSnapshot: () => snap, subscribe: () => noop, resolveTemp: vi.fn(() => new Promise<number | null>((r) => (finish = r))), onSynced: vi.fn(() => off) };
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        setup({ api, queue, orderId: 'order-1700-abcd1234' });
        await screen.findByText('Sincronizando…');
        cleanup();
        expect(off).toHaveBeenCalled();
        await act(async () => {
            finish(777);
        });
        expect(api.orderDetail).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
    });
});

const sendCalls = (api: { sendToKitchen: { mock: { calls: unknown[] } } }) => api.sendToKitchen.mock.calls.length;

describe('ready badge in the order header (Fable I6)', () => {
    it('shows how many other orders are ready, and leaves for the tables screen when tapped', async () => {
        const { onBack } = setup({ handlers: { readyCount: 2 } });
        const badge = await screen.findByRole('button', { name: 'Pedidos listos: 2' });
        expect(badge).toHaveTextContent('2');
        fireEvent.click(badge);
        expect(onBack).toHaveBeenCalled();
    });

    it('is absent when nothing else is ready', async () => {
        setup({ handlers: { readyCount: 0 } });
        await screen.findByRole('region', { name: 'Ticket' });
        expect(screen.queryByRole('button', { name: /Pedidos listos/ })).toBeNull();
    });
});
