import { AxiosError } from 'axios';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TablesScreen } from './TablesScreen';
import { activeOrders, makeApi, makeRealtime, result, userSession, type FakeTablesApi } from './testkit';
import { TableHasLocalOrderError } from '../../../data/waiterApi';

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
        await waitFor(() => expect(api.createOrder).toHaveBeenCalledWith({ tableId: 1, guests: 3, orderType: 'DINE_IN' }, expect.objectContaining({ actionId: expect.any(String), meta: { label: 'Abrir mesa 1' } })));
        await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith(555, undefined, 1, '1'));
    });

    it('an order created offline opens with its temp id', async () => {
        const api = makeApi({ createOrder: vi.fn().mockResolvedValue({ success: true, _offline: true, entityTempId: 'order-1700-abcd1234', queueId: 1 }) });
        const { onOpenOrder } = setup({ api });
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        fireEvent.click(await screen.findByRole('button', { name: '2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Abrir y tomar pedido' }));
        await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith('order-1700-abcd1234', undefined, 1, '1'));
    });

    it('a table this device already opened offline opens that order instead of failing', async () => {
        const api = makeApi({ createOrder: vi.fn().mockRejectedValue(new TableHasLocalOrderError('order-1700-held0001')) });
        const { onOpenOrder } = setup({ api });
        await screen.findByTestId('tile-1');
        fireEvent.click(tile(1));
        fireEvent.click(await screen.findByRole('button', { name: '2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Abrir y tomar pedido' }));
        await waitFor(() => expect(onOpenOrder).toHaveBeenCalledWith('order-1700-held0001', undefined, 1, '1'));
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
        expect(onOpenOrder).toHaveBeenCalledWith(102, undefined, 2, '2');
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
        expect(await within(sheet).findByText('C$ 350.00')).toBeInTheDocument();
        for (const chip of ['3 pers', '25 min', '3 productos', '1 en cocina']) expect(within(sheet).getByText(chip)).toBeInTheDocument();
    });

    it('subtracts payments from the unpaid total', async () => {
        let release: (v: unknown) => void = () => undefined;
        const slow = new Promise((resolve) => {
            release = resolve;
        });
        setup({ api: makeApi({ orderDetail: vi.fn().mockReturnValue(slow) }) });
        await screen.findByTestId('tile-4');
        await longPress(tile(4));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByText('—')).toBeInTheDocument(); // while the paid amount loads
        // /orders/active has no payments: the paid amount comes from the order detail (ACTIVE payments only)
        release({ id: 104, payments: [{ amount: '100.00', status: 'ACTIVE' }, { amount: '50.00', status: 'REVERSED' }] });
        expect(await within(sheet).findByText('C$ 400.00')).toBeInTheDocument();
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
        expect(onOpenOrder).toHaveBeenCalledWith(102, 'pay', 2, '2');
    });

    it('transfer completes by tapping a destination table', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText(/Elige la mesa destino/)).toBeInTheDocument();
        fireEvent.click(tile(7)); // reserved: the server rejects it, so it is not offered
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
    it('offline shows a dash instead of a total it cannot know', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-4');
        setOnline(false);
        await longPress(tile(4));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByText('—')).toBeInTheDocument();
        expect(api.orderDetail).not.toHaveBeenCalled();
    });

    it('a failed paid-amount lookup keeps the dash', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockRejectedValue(new Error('x')) });
        setup({ api });
        await screen.findByTestId('tile-4');
        await longPress(tile(4));
        const sheet = await screen.findByRole('dialog');
        await waitFor(() => expect(api.orderDetail).toHaveBeenCalledWith(104));
        expect(within(sheet).getByText('—')).toBeInTheDocument();
    });

    it('destination mode ignores Mis mesas so free tables can be picked', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        fireEvent.click(screen.getByRole('button', { name: 'Mis mesas' }));
        expect(screen.queryByTestId('tile-1')).toBeNull();
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        fireEvent.click(await screen.findByTestId('tile-1'));
        await waitFor(() => expect(api.transfer).toHaveBeenCalledWith({ sourceTableId: 2, destinationTableId: 1, orderId: 102 }));
    });

    it('transfer also accepts an occupied destination, like the server', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Trasladar/ }));
        fireEvent.click(tile(3));
        await waitFor(() => expect(api.transfer).toHaveBeenCalledWith({ sourceTableId: 2, destinationTableId: 3, orderId: 102 }));
    });

    it('Unir only offers ungrouped, available tables', async () => {
        const { api } = setup();
        await screen.findByTestId('tile-2');
        await longPress(tile(2));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Unir/ }));
        fireEvent.click(tile(7)); // reserved
        expect(api.groupTables).not.toHaveBeenCalled();
    });

    it('a press shorter than 500 ms is a tap, not a long press', async () => {
        const { onOpenOrder } = setup();
        await screen.findByTestId('tile-2');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            fireEvent.pointerDown(tile(2));
            await act(async () => {
                vi.advanceTimersByTime(499);
            });
            fireEvent.pointerUp(tile(2));
            fireEvent.click(tile(2));
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });
        } finally {
            vi.useRealTimers();
        }
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onOpenOrder).toHaveBeenCalledWith(102, undefined, 2, '2');
    });
});

describe('Factura tile', () => {
    const INVOICED = (orders = activeOrders) => orders.map((o) => (o.id === 104 ? { ...o, invoiceNumber: 'F-7' } : o));
    const sheetOf = async (tileId: number) => {
        await screen.findByTestId(`tile-${tileId}`);
        await longPress(tile(tileId));
        return screen.findByRole('dialog');
    };
    const setupInvoiced = (permissions: string[], over: { invoicePdf?: ReturnType<typeof vi.fn> } = {}) => {
        const sharePdf = vi.fn().mockResolvedValue(undefined);
        const invoicePdf = over.invoicePdf ?? vi.fn().mockResolvedValue(new Blob(['%PDF']));
        const api = makeApi({ activeOrders: vi.fn().mockResolvedValue(result(INVOICED())), invoicePdf } as never);
        const props = { session: userSession(permissions), api, realtime: makeRealtime(), queue: null, invalidate: vi.fn().mockResolvedValue(undefined), onOpenOrder: vi.fn(), onSwitchUser: vi.fn(), printer: { sharePdf } };
        render(<TablesScreen {...props} />);
        return { sharePdf, invoicePdf };
    };

    it('Factura tile hidden without permission or invoice', async () => {
        // an invoiced order, but the user may only issue (the PDF route needs invoices.view)
        setupInvoiced(ALL);
        expect(within(await sheetOf(4)).queryByRole('button', { name: 'Factura' })).toBeNull();
        cleanup();
        // may view and issue, but table 2's order has no invoice yet
        setupInvoiced([...ALL, 'invoices.view']);
        expect(within(await sheetOf(2)).queryByRole('button', { name: 'Factura' })).toBeNull();
        cleanup();
        // may view but not issue
        setupInvoiced(['orders.view', 'tables.transfer', 'invoices.view']);
        expect(within(await sheetOf(4)).queryByRole('button', { name: 'Factura' })).toBeNull();
    });

    it('opens the invoice PDF of the order from the tile', async () => {
        const { sharePdf, invoicePdf } = setupInvoiced([...ALL, 'invoices.view']);
        const sheet = await sheetOf(4);
        fireEvent.click(within(sheet).getByRole('button', { name: 'Factura' }));
        await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
        expect(invoicePdf).toHaveBeenCalledWith(104);
        expect(sharePdf.mock.calls[0][1]).toBe('factura-F-7.pdf');
    });

    it('pdf download failure shows a retry message', async () => {
        const invoicePdf = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(new Blob(['%PDF']));
        const { sharePdf } = setupInvoiced([...ALL, 'invoices.view'], { invoicePdf });
        const sheet = await sheetOf(4);
        fireEvent.click(within(sheet).getByRole('button', { name: 'Factura' }));
        expect(await within(sheet).findByRole('alert')).toHaveTextContent('No se pudo abrir la factura');
        expect(sharePdf).not.toHaveBeenCalled();
        fireEvent.click(within(sheet).getByRole('button', { name: 'Factura' })); // tapping again retries
        await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
        expect(within(sheet).queryByRole('alert')).toBeNull();
    });
});
