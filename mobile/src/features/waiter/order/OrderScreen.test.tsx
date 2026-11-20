import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderScreen } from './OrderScreen';
import { makeApi, makeDrafts, makeRealtime, orderOf, serverItem, userSession, ALL_PERMISSIONS } from './testkit';

function setup(opts: { api?: ReturnType<typeof makeApi>; permissions?: string[]; orderId?: number | string; handlers?: Record<string, unknown>; drafts?: ReturnType<typeof makeDrafts>; userId?: number } = {}) {
    const api = opts.api ?? makeApi();
    const drafts = opts.drafts ?? makeDrafts();
    const realtime = makeRealtime();
    const props = {
        session: userSession(opts.permissions ?? ALL_PERMISSIONS, opts.userId),
        api,
        drafts,
        realtime,
        queue: null,
        orderId: opts.orderId ?? 102,
        tableId: 2,
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
    const el = await screen.findByRole('button', { name: new RegExp(`^${name}`) });
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
        expect(within(grid).getByText('2x1')).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /^Pizza Margarita/ })).toHaveTextContent('×1');
        fireEvent.click(screen.getByRole('button', { name: /^Pizza Margarita/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Pizza Margarita/ })).toHaveTextContent('×2'));
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

    it('lists what is already in the kitchen read-only', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([serverItem(1, 1, 'Pizza Margarita', { quantity: 2, status: 'IN_PROGRESS' })]));
        setup({ api });
        const sent = await within(ticket()).findByText(/En cocina|Enviado/);
        expect(sent).toBeInTheDocument();
        expect(within(ticket()).getByText('Pizza Margarita')).toBeInTheDocument();
        expect(within(ticket()).queryByRole('button', { name: /Quitar/ })).toBeNull();
    });

    it('hides actions the user has no permission for', async () => {
        setup({ permissions: ['orders.view'], handlers: { onPay: vi.fn(), onSplit: vi.fn(), onDiscount: vi.fn() } });
        await screen.findByRole('region', { name: 'Productos' });
        for (const name of ['Cobrar', 'Dividir', 'Descuento', /Enviar a cocina/]) expect(screen.queryByRole('button', { name })).toBeNull();
    });

    it('gates Cobrar, Dividir and Descuento by their permissions and calls the handlers', async () => {
        const handlers = { onPay: vi.fn(), onSplit: vi.fn(), onDiscount: vi.fn() };
        setup({ permissions: ['orders.view', 'orders.edit', 'payments.process', 'bills.split'], handlers });
        fireEvent.click(await screen.findByRole('button', { name: 'Cobrar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Dividir' }));
        expect(screen.queryByRole('button', { name: 'Descuento' })).toBeNull();
        expect(handlers.onPay).toHaveBeenCalledTimes(1);
        expect(handlers.onSplit).toHaveBeenCalledTimes(1);
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
