import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TablesScreen } from './TablesScreen';
import { makeApi, makeRealtime, result, userSession, type FakeTablesApi } from './testkit';

function setup(opts: { api?: FakeTablesApi; permissions?: string[] } = {}) {
    const api = opts.api ?? makeApi();
    const realtime = makeRealtime();
    const props = {
        session: userSession(opts.permissions ?? ['orders.view']),
        api,
        realtime,
        queue: null,
        invalidate: vi.fn().mockResolvedValue(undefined),
        onOpenOrder: vi.fn(),
        onSwitchUser: vi.fn(),
    };
    render(<TablesScreen {...props} />);
    return { ...props, api, realtime };
}

const tile = (id: number) => screen.getByTestId(`tile-${id}`);

describe('TablesScreen', () => {
    it('renders the four border states from the floor plan', async () => {
        setup();
        await screen.findByTestId('tile-1');
        expect(tile(1)).toHaveAttribute('data-state', 'free');
        expect(tile(2)).toHaveAttribute('data-state', 'occupied');
        expect(tile(3)).toHaveAttribute('data-state', 'ready');
        expect(tile(4)).toHaveAttribute('data-state', 'due');
    });

    it('Mis mesas filters by order.user.id', async () => {
        setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(screen.getByRole('button', { name: 'Mis mesas' }));
        expect(screen.getByRole('button', { name: 'Mis mesas' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('tile-2')).toBeInTheDocument(); // Ana (7)
        expect(screen.getByTestId('tile-4')).toBeInTheDocument();
        expect(screen.queryByTestId('tile-3')).toBeNull(); // Luis (9)
        expect(screen.queryByTestId('tile-1')).toBeNull(); // free
        fireEvent.click(screen.getByRole('button', { name: 'Mis mesas' }));
        expect(screen.getByTestId('tile-3')).toBeInTheDocument();
    });

    it('area tabs show counts and switch the plan', async () => {
        setup();
        await screen.findByTestId('tile-1');
        expect(screen.getByRole('tab', { name: 'Salón 5' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Terraza 2' })).toBeInTheDocument();
        expect(screen.queryByTestId('tile-5')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Terraza 2' }));
        expect(screen.getByTestId('tile-5')).toBeInTheDocument();
        expect(screen.queryByTestId('tile-1')).toBeNull();
    });

    it('header shows the branch and the active table count', async () => {
        setup();
        await screen.findByTestId('tile-1');
        expect(screen.getByText('Sucursal Centro · 4 mesas activas')).toBeInTheDocument();
    });

    it('tile text never exceeds three lines', async () => {
        setup();
        await screen.findByTestId('tile-1');
        for (const id of [1, 2, 3, 4]) {
            const lines = Array.from(tile(id).querySelectorAll('.tile-line'));
            expect(lines.length).toBeGreaterThan(0);
            expect(lines.length).toBeLessThanOrEqual(3);
            for (const line of lines) expect(line.textContent).not.toMatch(/\n/);
        }
        // the very long waiter name lives in one clipped line, not extra lines
        expect(within(tile(3)).getByText(/Luis Gomez Hernandez/)).toHaveClass('tile-line');
    });

    it('shows guests, elapsed time and the waiter on an occupied tile', async () => {
        setup();
        await screen.findByTestId('tile-2');
        expect(within(tile(2)).getByText('3 pers · 25 min')).toBeInTheDocument();
        expect(within(tile(2)).getByText('Ana Perez')).toBeInTheDocument();
    });

    it('ready banner appears on KITCHEN_NOTIFICATION and opens the order', async () => {
        const vibrate = vi.fn();
        Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
        const { realtime, onOpenOrder } = setup();
        await screen.findByTestId('tile-1');
        act(() => realtime.emit('KITCHEN_NOTIFICATION', { orderId: 103, tableNumber: '3', eventType: 'ORDER_READY' }));
        const banner = await screen.findByRole('button', { name: /Pedido listo · Mesa 3/ });
        expect(vibrate).toHaveBeenCalled();
        fireEvent.click(banner);
        expect(onOpenOrder).toHaveBeenCalledWith(103, undefined, 3);
    });

    it('ORDER_UPDATE triggers one debounced refetch', async () => {
        const { realtime, api, invalidate } = setup();
        await screen.findByTestId('tile-1');
        // mount: cached read, then a forced network refresh
        await waitFor(() => expect(api.activeOrders).toHaveBeenCalledTimes(2));
        expect(invalidate).toHaveBeenCalledTimes(1);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            act(() => {
                realtime.emit('ORDER_UPDATE', {});
                realtime.emit('ORDER_UPDATE', {});
                realtime.emit('TABLE_STATUS_CHANGED', {});
            });
            await act(async () => {
                vi.advanceTimersByTime(299);
            });
            expect(api.activeOrders).toHaveBeenCalledTimes(2);
            await act(async () => {
                vi.advanceTimersByTime(1);
            });
        } finally {
            vi.useRealTimers();
        }
        await waitFor(() => expect(api.activeOrders).toHaveBeenCalledTimes(3));
        expect(invalidate).toHaveBeenCalledTimes(2);
        expect(api.floorPlan).toHaveBeenCalledTimes(3);
    });

    it('subscribes only to the real server events', async () => {
        const { realtime } = setup();
        await screen.findByTestId('tile-1');
        const types = realtime.subscribe.mock.calls.map((c) => c[0]).sort();
        expect(types).toEqual(['KITCHEN_NOTIFICATION', 'ORDER_READY', 'ORDER_UPDATE', 'TABLE_STATUS_CHANGED']);
    });

    it('Cambiar usuario locks the session', async () => {
        const { onSwitchUser } = setup();
        fireEvent.click(await screen.findByRole('button', { name: 'Cambiar usuario' }));
        expect(onSwitchUser).toHaveBeenCalled();
    });

    it('shows a retry when loading fails', async () => {
        const api = makeApi({ floorPlan: vi.fn().mockRejectedValue(new Error('boom')) });
        setup({ api });
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(api.floorPlan).toHaveBeenCalledTimes(2));
    });
    it('first load forces a network refresh instead of trusting the TTL cache', async () => {
        const { api, invalidate } = setup();
        await screen.findByTestId('tile-1');
        await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(api.activeOrders).toHaveBeenCalledTimes(2));
    });

    it('unmount unsubscribes and clears the pending debounce timer', async () => {
        const api = makeApi();
        const realtime = makeRealtime();
        const unsubs: ReturnType<typeof vi.fn>[] = [];
        realtime.subscribe.mockImplementation((_t: string, _fn: unknown) => {
            const u = vi.fn();
            unsubs.push(u);
            return u;
        });
        const view = render(<TablesScreen session={userSession()} api={api} realtime={realtime} queue={null} invalidate={vi.fn().mockResolvedValue(undefined)} onOpenOrder={vi.fn()} onSwitchUser={vi.fn()} />);
        await screen.findByTestId('tile-1');
        await waitFor(() => expect(api.activeOrders).toHaveBeenCalledTimes(2));
        const handler = realtime.subscribe.mock.calls[0][1] as () => void;
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            act(() => handler());
            view.unmount();
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });
        } finally {
            vi.useRealTimers();
        }
        expect(unsubs).toHaveLength(4);
        for (const u of unsubs) expect(u).toHaveBeenCalledTimes(1);
        expect(api.activeOrders).toHaveBeenCalledTimes(2); // the pending refetch never fired
    });

    it('a PIN switch shows only the new user data, never the previous user tables', async () => {
        const first = setup();
        await screen.findByTestId('tile-2');
        expect(within(tile(2)).getByText('Ana Perez')).toBeInTheDocument();
        cleanup(); // lock: WaiterHome unmounts
        const other = makeApi({ activeOrders: vi.fn().mockResolvedValue(result([])) });
        render(<TablesScreen session={{ ...userSession(), user: { ...userSession().user, id: 9, name: 'Luis Gomez' } }} api={other} realtime={makeRealtime()} queue={null} invalidate={vi.fn().mockResolvedValue(undefined)} onOpenOrder={vi.fn()} onSwitchUser={vi.fn()} />);
        await screen.findByTestId('tile-1');
        expect(within(tile(2)).queryByText('Ana Perez')).toBeNull();
        expect(screen.queryByText('Ana Perez', { selector: '.tile-line' })).toBeNull();
        expect(first.api.activeOrders).toHaveBeenCalled();
    });

    it('banner ignores partial item-ready and released notifications', async () => {
        const { realtime } = setup();
        await screen.findByTestId('tile-1');
        act(() => realtime.emit('KITCHEN_NOTIFICATION', { orderId: 103, tableNumber: '3', eventType: 'ORDER_ITEM_READY' }));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', { orderId: 103, tableNumber: '3', eventType: 'ORDER_RELEASED' }));
        expect(screen.queryByText(/Pedido listo/)).toBeNull();
    });
});
