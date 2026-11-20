import { AxiosError } from 'axios';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TablesScreen } from './TablesScreen';
import { makeApi, makeRealtime, userSession, type FakeTablesApi } from './testkit';

const ALL = ['orders.view', 'orders.create', 'payments.process', 'invoices.issue', 'tables.transfer', 'tables.group.manage'];

function setup(opts: { api?: FakeTablesApi; permissions?: string[] } = {}) {
    const api = opts.api ?? makeApi();
    const props = {
        session: userSession(opts.permissions ?? ALL),
        api,
        realtime: makeRealtime(),
        queue: null,
        invalidate: vi.fn().mockResolvedValue(undefined),
        onOpenOrder: vi.fn(),
        onSwitchUser: vi.fn(),
    };
    render(<TablesScreen {...props} />);
    return { ...props, api };
}

const tile = (id: number) => screen.getByTestId(`tile-${id}`);

/** Hold a tile for 500 ms (pointer down, wait, release). */
async function longPress(el: HTMLElement) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
        fireEvent.pointerDown(el);
        await act(async () => {
            vi.advanceTimersByTime(500);
        });
        fireEvent.pointerUp(el);
    } finally {
        vi.useRealTimers();
    }
}

function setOnline(online: boolean) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    act(() => {
        window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('open table', () => {
    it('opening sends guests and navigates to the order', async () => {
        const { api, onOpenOrder } = setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        const sheet = await screen.findByRole('dialog', { name: /Abrir mesa 1/ });
        expect(within(sheet).getByText('Mesa 1 · Salón · capacidad 4')).toBeInTheDocument();
        const open = within(sheet).getByRole('button', { name: 'Abrir y tomar pedido' });
        expect(open).toBeDisabled(); // pick the guests first
        fireEvent.click(within(sheet).getByRole('button', { name: '3' }));
        fireEvent.click(open);
        await waitFor(() => expect(api.createOrder).toHaveBeenCalledWith({ tableId: 1, guests: 3, orderType: 'DINE_IN' }));
        await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith(555));
    });

    it('an order created offline opens with its temp id', async () => {
        const api = makeApi({ createOrder: vi.fn().mockResolvedValue({ success: true, _offline: true, entityTempId: 'order-1700-abcd1234', queueId: 1 }) });
        const { onOpenOrder } = setup({ api });
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        fireEvent.click(await screen.findByRole('button', { name: '2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Abrir y tomar pedido' }));
        await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith('order-1700-abcd1234'));
    });

    it('double tap on the open button creates one order', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        fireEvent.click(await screen.findByRole('button', { name: '2' }));
        const open = screen.getByRole('button', { name: 'Abrir y tomar pedido' });
        fireEvent.click(open);
        fireEvent.click(open);
        await waitFor(() => expect(api.createOrder).toHaveBeenCalledTimes(1));
    });

    it('dims guest counts above the capacity and suggests joining tables', async () => {
        setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByRole('button', { name: '4' })).not.toHaveAttribute('data-over-capacity');
        expect(within(sheet).getByRole('button', { name: '5' })).toHaveAttribute('data-over-capacity', 'true');
        expect(within(sheet).getByText(/unir mesas/i)).toBeInTheDocument();
        fireEvent.click(within(sheet).getByRole('button', { name: 'Más' }));
        expect(within(sheet).getByRole('button', { name: '9' })).toBeInTheDocument();
    });

    it('shows the server message when opening fails', async () => {
        const api = makeApi({ createOrder: vi.fn().mockRejectedValue(new AxiosError('fail', '400', undefined, null, { status: 400, data: { success: false, message: 'La mesa no está disponible' }, statusText: '', headers: {}, config: {} as never })) });
        setup({ api });
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        fireEvent.click(await screen.findByRole('button', { name: '2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Abrir y tomar pedido' }));
        expect(await screen.findByText('La mesa no está disponible')).toBeInTheDocument();
    });

    it('without orders.create the sheet has no open button', async () => {
        setup({ permissions: ['orders.view'] });
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).queryByRole('button', { name: 'Abrir y tomar pedido' })).toBeNull();
        expect(within(sheet).getByText(/permiso/i)).toBeInTheDocument();
    });

    it('tapping an occupied table opens its order', async () => {
        const { onOpenOrder } = setup();
        await screen.findByTestId('tile-2');
        fireEvent.click(tile(2));
        expect(onOpenOrder).toHaveBeenCalledWith(102);
    });
});

describe('table actions', () => {
    it('long press opens the sheet with table, area, waiter, unpaid total and chips', async () => {
        const { onOpenOrder } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        const sheet = await screen.findByRole('dialog', { name: /Acciones de la mesa 2/ });
        expect(onOpenOrder).not.toHaveBeenCalled(); // the release after a long press is not a tap
        expect(within(sheet).getByText('Mesa 2 · Salón')).toBeInTheDocument();
        expect(within(sheet).getByText('Ana Perez')).toBeInTheDocument();
        expect(within(sheet).getByText('C$ 350.00')).toBeInTheDocument();
        for (const chip of ['3 pers', '25 min', '3 productos', '1 en cocina']) expect(within(sheet).getByText(chip)).toBeInTheDocument();
    });

    it('subtracts payments from the unpaid total', async () => {
        setup();
        await screen.findByTestId('tile-4');
        await longPress(tile(4));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByText('C$ 400.00')).toBeInTheDocument();
    });

    it('actions sheet hides buttons without permission', async () => {
        setup({ permissions: ['orders.view'] });
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByRole('button', { name: 'Ver pedido' })).toBeInTheDocument();
        for (const name of ['Cobrar', 'Trasladar', 'Unir', 'Factura']) expect(within(sheet).queryByRole('button', { name })).toBeNull();
    });

    it('Cobrar needs both payments.process and invoices.issue', async () => {
        setup({ permissions: ['orders.view', 'payments.process'] });
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).queryByRole('button', { name: 'Cobrar' })).toBeNull();
    });

    it('Ver pedido and Cobrar open the order with their intent', async () => {
        const { onOpenOrder } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cobrar' }));
        expect(onOpenOrder).toHaveBeenCalledWith(102, 'pay');
    });

    it('transfer completes by tapping a destination table', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText(/Elige la mesa destino/)).toBeInTheDocument();
        fireEvent.click(tile(3)); // occupied: not a valid destination
        expect(api.transfer).not.toHaveBeenCalled();
        fireEvent.click(tile(1));
        await waitFor(() => expect(api.transfer).toHaveBeenCalledWith({ sourceTableId: 2, destinationTableId: 1, orderId: 102 }));
        expect(await screen.findByText('Mesa 2 trasladada a la mesa 1')).toBeInTheDocument();
        expect(screen.queryByText(/Elige la mesa destino/)).toBeNull();
    });

    it('Unir joins the chosen free table to this one', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Unir/ }));
        fireEvent.click(tile(1));
        await waitFor(() => expect(api.groupTables).toHaveBeenCalledWith({ primaryTableId: 2, memberTableIds: [1] }));
    });

    it('cancelling the destination mode leaves everything as it was', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByText(/Elige la mesa destino/)).toBeNull();
        expect(api.transfer).not.toHaveBeenCalled();
    });

    it('offline shows "requiere conexión" for transfer', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        setOnline(false);
        await longPress(tile(2));
        const sheet = await screen.findByRole('dialog');
        const transfer = within(sheet).getByRole('button', { name: /Trasladar/ });
        expect(transfer).toBeDisabled();
        expect(within(transfer).getByText('requiere conexión')).toBeInTheDocument();
        expect(within(sheet).getByRole('button', { name: /Unir/ })).toBeDisabled();
        fireEvent.click(transfer);
        expect(api.transfer).not.toHaveBeenCalled();
    });

    it('transfer of an order that has not synced explains it needs a connection', async () => {
        const err = Object.assign(new Error('El pedido aún no se sincroniza; esta operación requiere conexión'), { name: 'OrderNotSyncedError' });
        const api = makeApi({ transfer: vi.fn().mockRejectedValue(err) });
        setup({ api });
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        fireEvent.click(tile(1));
        expect(await screen.findByText(/requiere conexión/)).toBeInTheDocument();
    });
});
