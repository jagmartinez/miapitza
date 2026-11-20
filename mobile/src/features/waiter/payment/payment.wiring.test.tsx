import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderScreen } from '../order/OrderScreen';
import { makeApi, makeDrafts, makeRealtime, orderOf, serverItem, userSession } from '../order/testkit';

const CASHIER = ['orders.view', 'payments.process', 'invoices.issue', 'bills.split'];
const WAITER = ['orders.view', 'orders.create', 'orders.edit', 'orders.deliver', 'bills.split'];

const sentOrder = (over: Record<string, unknown> = {}) =>
    orderOf([serverItem(1, 1, 'Pizza Margarita', { price: '100.00', subtotal: '100.00' })], { branchId: 1, tax: '15.00', total: '115.00', discount: '0.00', tipAmount: '0.00', ...over });

function setup(opts: { permissions?: string[]; intent?: 'view' | 'pay'; orderId?: number | string; order?: Record<string, unknown>; api?: ReturnType<typeof makeApi> } = {}) {
    const api =
        opts.api ??
        makeApi({
            orderDetail: vi.fn().mockResolvedValue(opts.order ?? sentOrder()),
            paymentMethods: vi.fn().mockResolvedValue([{ id: 2, name: 'Tarjeta', type: 'CARD', active: true }]),
            paymentSummary: vi.fn().mockResolvedValue({ remaining: 115 }),
            cashShiftStatus: vi.fn().mockResolvedValue({ hasActiveShift: false }),
            settings: vi.fn().mockResolvedValue({}),
        });
    const props = {
        session: userSession(opts.permissions ?? CASHIER),
        api,
        drafts: makeDrafts(),
        realtime: makeRealtime(),
        queue: null,
        orderId: opts.orderId ?? 102,
        tableId: 2,
        intent: opts.intent ?? ('view' as const),
        invalidate: vi.fn().mockResolvedValue(undefined),
        onBack: vi.fn(),
    };
    render(<OrderScreen {...props} />);
    return { ...props, api };
}

const ticket = () => screen.getByRole('region', { name: 'Ticket' });
const cobrar = async () => within(await screen.findByRole('region', { name: 'Ticket' })).findByRole('button', { name: 'Cobrar' });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Cobrar entry points', () => {
    it('button hidden for a waiter without payments.process', async () => {
        setup({ permissions: WAITER });
        await screen.findByRole('region', { name: 'Productos' });
        expect(within(ticket()).queryByRole('button', { name: 'Cobrar' })).toBeNull();
        expect(within(ticket()).queryByRole('button', { name: 'Dividir' })).toBeNull(); // Dividir ends in a payment the waiter cannot take
    });

    it('payments.process alone is not enough: the cashier needs invoices.issue too', async () => {
        setup({ permissions: ['orders.view', 'payments.process', 'bills.split'] });
        await screen.findByRole('region', { name: 'Productos' });
        expect(within(ticket()).queryByRole('button', { name: 'Cobrar' })).toBeNull();
        expect(within(ticket()).queryByRole('button', { name: 'Dividir' })).toBeNull();
    });

    it('a cashier opens the payment screen from Cobrar and comes back to the order', async () => {
        const { api } = setup();
        fireEvent.click(await cobrar());
        expect(await screen.findByText('Cobrar · Mesa 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Un pago' })).toHaveAttribute('aria-pressed', 'true');
        const loads = api.orderDetail.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
        await waitFor(() => expect(screen.queryByText('Cobrar · Mesa 2')).toBeNull());
        await waitFor(() => expect(api.orderDetail.mock.calls.length).toBeGreaterThan(loads)); // partial payments show on return
        expect(screen.getByRole('region', { name: 'Ticket' })).toBeInTheDocument();
    });

    it('Dividir opens the payment screen in split mode', async () => {
        setup();
        fireEvent.click(await within(await screen.findByRole('region', { name: 'Ticket' })).findByRole('button', { name: 'Dividir' }));
        expect(await screen.findByText('Cobrar · Mesa 2')).toBeInTheDocument();
        expect(within(screen.getByTestId('payment-screen')).getByRole('button', { name: 'Dividir' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('the table action Cobrar (intent pay) goes straight to the payment', async () => {
        setup({ intent: 'pay' });
        expect(await screen.findByText('Cobrar · Mesa 2')).toBeInTheDocument();
    });

    it('intent pay without the cashier permissions stays on the order', async () => {
        setup({ intent: 'pay', permissions: WAITER });
        await screen.findByRole('region', { name: 'Productos' });
        expect(screen.queryByText('Cobrar · Mesa 2')).toBeNull();
    });

    it('Liberar mesa y volver refreshes the lists and leaves the order', async () => {
        const { onBack, invalidate } = setup();
        fireEvent.click(await cobrar());
        await screen.findByText('Cobrar · Mesa 2');
        fireEvent.click(screen.getByRole('button', { name: 'Tarjeta' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cobrar C$ 115' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Liberar mesa y volver' }));
        await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
        expect(invalidate).toHaveBeenCalled();
    });

    it('refuses to open without connection', async () => {
        setup();
        const button = await cobrar();
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Cobrar requiere conexión.');
        expect(screen.queryByText('Cobrar · Mesa 2')).toBeNull();
    });

    it('refuses an order that still only exists in the offline queue', async () => {
        setup({ orderId: 'order-1700000000000-abcd1234' });
        fireEvent.click(await cobrar());
        expect(await screen.findByRole('alert')).toHaveTextContent('Sincronizando pedido');
        expect(screen.queryByText('Cobrar · Mesa 2')).toBeNull();
    });

    it('refuses while there are products not sent to the kitchen', async () => {
        const order = orderOf([serverItem(1, 1, 'Pizza Margarita', { sentAt: null, status: 'PENDING' })], { branchId: 1, total: '57.50' });
        setup({ order });
        fireEvent.click(await cobrar());
        expect(await screen.findByRole('alert')).toHaveTextContent('Envía a cocina los productos nuevos antes de cobrar.');
        expect(screen.queryByText('Cobrar · Mesa 2')).toBeNull();
    });

    it('refuses an empty order', async () => {
        setup({ order: orderOf([], { branchId: 1, total: '0.00' }) });
        fireEvent.click(await cobrar());
        expect(await screen.findByRole('alert')).toHaveTextContent('No hay productos para cobrar.');
    });
});
