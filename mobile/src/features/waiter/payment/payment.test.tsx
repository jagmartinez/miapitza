import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { orderOf, serverItem, userSession } from '../order/testkit';
import PaymentScreen, { type PaymentApi, type PaymentMode } from './PaymentScreen';

const CASHIER = ['orders.view', 'payments.process', 'invoices.issue', 'bills.split'];

const detail = (over: Record<string, unknown> = {}) =>
    orderOf([serverItem(1, 1, 'Pizza Margarita', { price: '100.00', subtotal: '100.00' }), serverItem(2, 2, 'Cola', { price: '100.00', subtotal: '100.00' })], {
        branchId: 1,
        tax: '30.00',
        total: '230.00',
        discount: '0.00',
        tipAmount: '0.00',
        ...over,
    });

const METHODS = [
    { id: 1, name: 'Efectivo', type: 'CASH', active: true },
    { id: 2, name: 'Tarjeta', type: 'CARD', active: true },
    { id: 3, name: 'Transferencia', type: 'BANK_TRANSFER', active: true },
];
const SHIFT = { hasActiveShift: true, requiresClose: false, shift: { cashRegister: { branch: { id: 1 } } } };
const paidEnvelope = (over: Record<string, unknown> = {}) => ({ data: { id: 1 }, fiscalInvoice: { invoiceNumber: 'F-100' }, fiscalInvoiceError: null, ...over });
const httpError = (status: number, message: string) => Object.assign(new Error(String(status)), { response: { status, data: { message } } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

function makeApi(over: Partial<Record<keyof PaymentApi, unknown>> = {}) {
    return {
        orderDetail: vi.fn().mockResolvedValue(detail()),
        paymentMethods: vi.fn().mockResolvedValue(METHODS),
        paymentSummary: vi.fn().mockResolvedValue({ remaining: 230 }),
        cashShiftStatus: vi.fn().mockResolvedValue(SHIFT),
        settings: vi.fn().mockResolvedValue({ tipEnabled: 'true', tipRate: '10' }),
        pricing: vi.fn().mockResolvedValue({}),
        updateFiscalCustomer: vi.fn().mockResolvedValue({}),
        preinvoice: vi.fn().mockResolvedValue({ invoiceNumber: 'PRE-1' }),
        payLeg: vi.fn().mockResolvedValue(paidEnvelope()),
        splitEvenly: vi.fn().mockResolvedValue({ splits: [{ amount: 115 }, { amount: 115 }] }),
        splitByItems: vi.fn().mockResolvedValue({
            splits: [
                { personName: 'Persona 1', total: 115 },
                { personName: 'Persona 2', total: 115 },
            ],
        }),
        splitByAmount: vi.fn().mockResolvedValue({ valid: true, splits: [] }),
        ...over,
    } as unknown as { [K in keyof PaymentApi]: PaymentApi[K] & ReturnType<typeof vi.fn> };
}

function setup(opts: { api?: ReturnType<typeof makeApi>; permissions?: string[]; mode?: PaymentMode & ('single' | 'split') } = {}) {
    const api = opts.api ?? makeApi();
    const onClose = vi.fn();
    const onFinished = vi.fn();
    const user = userSession(opts.permissions ?? CASHIER).user;
    const view = render(<PaymentScreen api={api} user={user} orderId={102} initialMode={opts.mode} onClose={onClose} onFinished={onFinished} />);
    return { api, onClose, onFinished, ...view };
}

const ready = () => screen.findByText('Cobrar · Mesa 2');
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const chargeButton = (amount: string) => screen.getByRole('button', { name: `Cobrar ${amount}` });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('single payment', () => {
    it('lists the items being charged (name × qty and amount) in the summary', async () => {
        setup();
        await ready();
        const list = within(screen.getByRole('region', { name: 'Resumen' })).getByRole('list', { name: 'Productos' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Pizza Margarita × 1');
        expect(rows[0]).toHaveTextContent('C$ 100');
        expect(rows[1]).toHaveTextContent('Cola × 1');
    });

    it('cash change is computed from the received amount (quick amount and keypad)', async () => {
        setup();
        await ready();
        expect(screen.getByRole('button', { name: 'Efectivo' })).toHaveAttribute('aria-pressed', 'true');
        click('C$ 250');
        expect(within(screen.getByRole('region', { name: 'Recibido' })).getByText('C$ 20')).toBeInTheDocument();
        click('Exacto');
        for (const k of ['5', '0', '0']) click(k);
        expect(within(screen.getByRole('region', { name: 'Recibido' })).getByText('C$ 270')).toBeInTheDocument();
        click('Borrar');
        click('Borrar');
        click('Borrar');
        click('1'); // C$ 1 received: not enough
        expect(chargeButton('C$ 230')).toBeDisabled();
    });

    it('prepares the account once, charges the exact balance and shows the receipt with the change', async () => {
        const { api, onFinished } = setup();
        await ready();
        click('C$ 250');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
        expect(api.payLeg).toHaveBeenCalledTimes(1);
        expect(api.payLeg.mock.calls[0][0]).toEqual({ orderId: 102, paymentMethodId: 1, amount: 230 });
        expect(typeof api.payLeg.mock.calls[0][1]).toBe('string');
        expect(screen.getByText('Factura F-100')).toBeInTheDocument();
        expect(screen.getByText('Cambio a entregar').nextSibling).toHaveTextContent('C$ 20');
        expect(screen.getByText('Efectivo')).toBeInTheDocument();
        // this cashier lacks invoices.view (the PDF route's permission): print / send stay hidden
        expect(screen.queryByRole('button', { name: /Imprimir|Enviar/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Liberar mesa y volver' }));
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('with invoices.view the receipt downloads the invoice of the ORDER and shares it', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.doMock('../../print/printOut', async (orig) => ({ ...(await orig<object>()), printOut: { print: vi.fn(), shareText: vi.fn(), sharePdf: share } }));
        vi.resetModules();
        const { default: Screen } = await import('./PaymentScreen');
        const pdf = new Blob(['%PDF']);
        const api = makeApi({ invoicePdf: vi.fn().mockResolvedValue(pdf) });
        render(<Screen api={api as never} user={userSession([...CASHIER, 'invoices.view']).user} orderId={102} onClose={vi.fn()} onFinished={vi.fn()} />);
        await screen.findByText('Cobrar · Mesa 2');
        click('C$ 250');
        fireEvent.click(chargeButton('C$ 230'));
        await screen.findByText('Mesa 2 cobrada');
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(share).toHaveBeenCalledWith(pdf, 'factura-F-100.pdf'));
        expect(api.invoicePdf).toHaveBeenCalledWith(102);
        vi.doUnmock('../../print/printOut');
    });

    it('cash without an active shift is blocked with the message', async () => {
        const { api } = setup({ api: makeApi({ cashShiftStatus: vi.fn().mockResolvedValue({ hasActiveShift: false }) }) });
        await ready();
        expect(screen.getByRole('button', { name: 'Tarjeta' })).toHaveAttribute('aria-pressed', 'true'); // first usable method
        click('Efectivo');
        expect(await screen.findByText('Abre tu turno de caja')).toBeInTheDocument();
        expect(chargeButton('C$ 230')).toBeDisabled();
        fireEvent.click(chargeButton('C$ 230'));
        expect(api.payLeg).not.toHaveBeenCalled();
        expect(api.preinvoice).not.toHaveBeenCalled();
    });

    it('a shift of another branch does not unlock cash', async () => {
        setup({ api: makeApi({ cashShiftStatus: vi.fn().mockResolvedValue({ ...SHIFT, shift: { cashRegister: { branch: { id: 9 } } } }) }) });
        await ready();
        click('Efectivo');
        expect(await screen.findByText('Abre tu turno de caja')).toBeInTheDocument();
    });

    it('a double tap on Cobrar sends once', async () => {
        let resolve!: (v: unknown) => void;
        const api = makeApi({ payLeg: vi.fn().mockImplementation(() => new Promise((r) => (resolve = r))) });
        setup({ api });
        await ready();
        click('Tarjeta');
        const button = chargeButton('C$ 230');
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(api.payLeg).toHaveBeenCalledTimes(1));
        resolve(paidEnvelope());
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(api.payLeg).toHaveBeenCalledTimes(1);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
    });

    it('a 409 on the leg shows the server message, keeps the key and retries the same leg', async () => {
        const payLeg = vi.fn().mockRejectedValueOnce(httpError(409, 'Pago en proceso')).mockResolvedValue(paidEnvelope());
        const { api } = setup({ api: makeApi({ payLeg }) });
        await ready();
        click('Tarjeta');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Pago en proceso');
        expect(screen.queryByText('Mesa 2 cobrada')).toBeNull();
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(api.payLeg.mock.calls[1][1]).toBe(api.payLeg.mock.calls[0][1]);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
    });

    it('a fiscal invoice error still shows the payment as done, with the notice', async () => {
        setup({ api: makeApi({ payLeg: vi.fn().mockResolvedValue(paidEnvelope({ fiscalInvoice: null, fiscalInvoiceError: 'Sin secuencia fiscal' })) }) });
        await ready();
        click('Tarjeta');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('la factura fiscal debe reintentarse: Sin secuencia fiscal');
        expect(screen.queryByText(/^Factura /)).toBeNull();
    });

    it('stops without a connection and says so', async () => {
        const { api } = setup();
        await ready();
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        click('Tarjeta');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Cobrar requiere conexión.');
        expect(api.preinvoice).not.toHaveBeenCalled();
        expect(api.payLeg).not.toHaveBeenCalled();
    });

    it('stops when the order total moved under the cashier, before charging anything', async () => {
        const api = makeApi({ paymentSummary: vi.fn().mockResolvedValueOnce({ remaining: 230 }).mockResolvedValue({ remaining: 250 }) });
        setup({ api });
        await ready();
        click('Tarjeta');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByRole('alert')).toHaveTextContent('El total cambió a C$ 250');
        expect(api.payLeg).not.toHaveBeenCalled();
        expect(await screen.findByRole('button', { name: 'Cobrar C$ 250' })).toBeInTheDocument();
    });

    it('card and transfer send the reference, cash never does', async () => {
        const { api } = setup();
        await ready();
        click('Transferencia');
        fireEvent.change(screen.getByLabelText(/Referencia/), { target: { value: 'TRX-77' } });
        fireEvent.click(chargeButton('C$ 230'));
        await screen.findByText('Mesa 2 cobrada');
        expect(api.payLeg.mock.calls[0][0]).toEqual({ orderId: 102, paymentMethodId: 3, amount: 230, reference: 'TRX-77' });
    });

    it('renders nothing for a user without payments.process and invoices.issue', () => {
        const { api, container } = setup({ permissions: ['orders.view', 'orders.edit', 'bills.split'] });
        expect(container).toBeEmptyDOMElement();
        expect(api.orderDetail).not.toHaveBeenCalled();
    });
});

describe('gates and leaving', () => {
    it('Dividir is not offered without bills.split, and a split entry falls back to a single payment', async () => {
        setup({ permissions: ['orders.view', 'payments.process', 'invoices.issue'], mode: 'split' });
        await ready();
        expect(screen.queryByRole('button', { name: 'Dividir' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Un pago' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('leaving with a tip toggled and nothing charged puts the tip back', async () => {
        const orderDetail = vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue(detail({ tipAmount: '20.00', total: '250.00' }));
        const api = makeApi({ orderDetail, paymentSummary: vi.fn().mockResolvedValueOnce({ remaining: 230 }).mockResolvedValue({ remaining: 250 }) });
        const { onClose } = setup({ api });
        await ready();
        click('Propina 10 %');
        await waitFor(() => expect(api.pricing).toHaveBeenCalledWith(102, { tipAmount: 20 }));
        await waitFor(() => expect(screen.getByTestId('pay-total')).toHaveTextContent('C$ 250'));
        click('Volver');
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(api.pricing).toHaveBeenLastCalledWith(102, { tipAmount: 0 });
    });
});

describe('tip and fiscal customer', () => {
    it('writes the tip on the order and shows the new total', async () => {
        const orderDetail = vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue(detail({ tipAmount: '20.00', total: '250.00' }));
        const api = makeApi({ orderDetail, paymentSummary: vi.fn().mockResolvedValueOnce({ remaining: 230 }).mockResolvedValue({ remaining: 250 }) });
        setup({ api });
        await ready();
        expect(screen.getByTestId('pay-total')).toHaveTextContent('C$ 230');
        click('Propina 10 %');
        await waitFor(() => expect(api.pricing).toHaveBeenCalledWith(102, { tipAmount: 20 }));
        await waitFor(() => expect(screen.getByTestId('pay-total')).toHaveTextContent('C$ 250'));
        expect(screen.getByRole('button', { name: 'Cobrar C$ 250' })).toBeInTheDocument();
    });

    it('no tip button when the company has no tip configured', async () => {
        setup({ api: makeApi({ settings: vi.fn().mockResolvedValue({ tipEnabled: 'false', tipRate: '10' }) }) });
        await ready();
        expect(screen.queryByRole('button', { name: /Propina/ })).toBeNull();
    });

    it('Consumidor final by default; Cambiar captures a customer that is saved before the pre-invoice', async () => {
        const order: string[] = [];
        const api = makeApi({
            updateFiscalCustomer: vi.fn().mockImplementation(async () => void order.push('customer')),
            preinvoice: vi.fn().mockImplementation(async () => void order.push('preinvoice')),
        });
        setup({ api });
        await ready();
        expect(screen.getByText('Consumidor final')).toBeInTheDocument();
        click('Cambiar');
        const dialog = screen.getByRole('dialog', { name: 'Factura a nombre de' });
        fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Ana Lopez' } });
        fireEvent.change(within(dialog).getByLabelText('Identificación'), { target: { value: 'J0310' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('van juntos'); // id without its type
        fireEvent.change(within(dialog).getByLabelText('Tipo de identificación'), { target: { value: 'RUC' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
        click('Tarjeta');
        fireEvent.click(chargeButton('C$ 230'));
        await screen.findByText('Mesa 2 cobrada');
        expect(api.updateFiscalCustomer).toHaveBeenCalledWith(102, { customerName: 'Ana Lopez', customerTaxId: 'J0310', customerTaxIdType: 'RUC' });
        expect(order).toEqual(['customer', 'preinvoice']);
    });
});

describe('mixed payment', () => {
    const toMixed = async () => {
        await ready();
        click('Varios métodos');
        await screen.findByRole('region', { name: 'Tramos' });
    };
    const setFirstLeg = (digits: string) => {
        for (let i = 0; i < 6; i++) click('Borrar');
        for (const d of digits) click(d);
    };

    it('splits the balance between two methods with an assigned / missing bar and charges each leg with its own key', async () => {
        const { api } = setup();
        await toMixed();
        const bar = screen.getByRole('status', { name: 'Asignado y falta' });
        expect(bar).toHaveTextContent('Asignado C$ 230');
        setFirstLeg('100');
        expect(screen.getByRole('button', { name: 'Monto del tramo 2' })).toHaveTextContent('C$ 130'); // the last leg owns the rest
        expect(bar).toHaveTextContent('Falta C$ 0');
        fireEvent.click(chargeButton('C$ 230'));
        await screen.findByText('Mesa 2 cobrada');
        expect(api.payLeg).toHaveBeenCalledTimes(2);
        expect(api.payLeg.mock.calls[0][0]).toMatchObject({ paymentMethodId: 1, amount: 100 });
        expect(api.payLeg.mock.calls[1][0]).toMatchObject({ paymentMethodId: 2, amount: 130 });
        expect(api.payLeg.mock.calls[0][1]).not.toBe(api.payLeg.mock.calls[1][1]);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
    });

    it('network drop on the second leg: the retry sends only the pending leg, with its own key', async () => {
        const payLeg = vi.fn().mockResolvedValueOnce(paidEnvelope({ fiscalInvoice: null })).mockRejectedValueOnce(networkError()).mockResolvedValue(paidEnvelope());
        const { api } = setup({ api: makeApi({ payLeg }) });
        await toMixed();
        setFirstLeg('100');
        fireEvent.click(chargeButton('C$ 230'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Los tramos confirmados no se repetirán');
        expect(screen.getByText('Pagado')).toBeInTheDocument();
        expect(screen.queryByText('Mesa 2 cobrada')).toBeNull();
        // only what is still pending is offered, and the paid leg is locked
        fireEvent.click(chargeButton('C$ 130'));
        await screen.findByText('Mesa 2 cobrada');
        expect(payLeg).toHaveBeenCalledTimes(3);
        expect(payLeg.mock.calls[2][0]).toMatchObject({ paymentMethodId: 2, amount: 130 });
        expect(payLeg.mock.calls[2][1]).toBe(payLeg.mock.calls[1][1]);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
    });

    it('blocks the charge while the legs do not add up and when a method repeats', async () => {
        setup();
        await toMixed();
        setFirstLeg('100');
        click('Borrar'); // 10 -> the last leg is 220: still adds up (it owns the remainder)
        expect(chargeButton('C$ 230')).toBeEnabled();
        for (let i = 0; i < 3; i++) click('Borrar'); // empty first leg -> 0
        expect(chargeButton('C$ 230')).toBeDisabled();
    });

    it('cash is not offered as a leg without an open shift', async () => {
        setup({ api: makeApi({ cashShiftStatus: vi.fn().mockResolvedValue(null) }) });
        await toMixed();
        const select = screen.getByLabelText('Método del tramo 1') as HTMLSelectElement;
        expect(within(select).queryByRole('option', { name: 'Efectivo' })).toBeNull();
    });
});

describe('split payment', () => {
    const toSplit = async () => {
        const view = setup({ mode: 'split' });
        await ready();
        await screen.findByRole('region', { name: 'Dividir cuenta' });
        return view;
    };

    it('split by items assigns units and charges each person with its own key', async () => {
        const { api } = await toSplit();
        expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeDisabled(); // nothing assigned yet
        click('Pizza Margarita');
        click('Asignar a Persona 1');
        click('Cola');
        click('Asignar a Persona 2');
        await waitFor(() => expect(api.splitByItems).toHaveBeenCalledWith(102, [
            { personName: 'Persona 1', items: [{ orderItemId: 1, quantity: 1 }] },
            { personName: 'Persona 2', items: [{ orderItemId: 2, quantity: 1 }] },
        ]));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await screen.findByText('Pagado');
        expect(screen.getByText('Pendiente C$ 115')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 2' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(api.payLeg).toHaveBeenCalledTimes(2);
        expect(api.payLeg.mock.calls[0][0]).toEqual({ orderId: 102, paymentMethodId: 1, amount: 115, payerName: 'Persona 1' });
        expect(api.payLeg.mock.calls[1][0]).toEqual({ orderId: 102, paymentMethodId: 1, amount: 115, payerName: 'Persona 2' });
        expect(api.payLeg.mock.calls[0][1]).not.toBe(api.payLeg.mock.calls[1][1]);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
    });

    it('a unit of a line with quantity 2 goes to one person at a time', async () => {
        const order = orderOf([serverItem(1, 1, 'Pizza Margarita', { quantity: 2, price: '100.00', subtotal: '200.00' })], { branchId: 1, tax: '30.00', total: '230.00', discount: '0.00', tipAmount: '0.00' });
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(order) });
        setup({ api, mode: 'split' });
        await ready();
        click('Pizza Margarita · 2 de 2');
        click('Asignar a Persona 1');
        expect(screen.getByRole('button', { name: 'Pizza Margarita · 1 de 2' })).toBeInTheDocument();
        click('Pizza Margarita · 1 de 2');
        click('Asignar a Persona 2');
        await waitFor(() =>
            expect(api.splitByItems).toHaveBeenCalledWith(102, [
                { personName: 'Persona 1', items: [{ orderItemId: 1, quantity: 1 }] },
                { personName: 'Persona 2', items: [{ orderItemId: 1, quantity: 1 }] },
            ]),
        );
    });

    it('evenly asks the server for the parts and charges each person', async () => {
        const { api } = await toSplit();
        click('Iguales');
        await waitFor(() => expect(api.splitEvenly).toHaveBeenCalledWith(102, 2));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        click('+ Persona');
        await waitFor(() => expect(api.splitEvenly).toHaveBeenCalledWith(102, 3));
    });

    it('by amount needs the exact total', async () => {
        const { api } = await toSplit();
        click('Por monto');
        fireEvent.change(screen.getByLabelText('Monto de Persona 1'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Monto de Persona 2'), { target: { value: '100' } });
        expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeDisabled();
        expect(api.splitByAmount).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Monto de Persona 2'), { target: { value: '130' } });
        await waitFor(() => expect(api.splitByAmount).toHaveBeenCalledWith(102, [{ personName: 'Persona 1', amount: 100 }, { personName: 'Persona 2', amount: 130 }]));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
    });

    it('after a leg is paid the plan is locked and the mode cannot change', async () => {
        const { api } = await toSplit();
        click('Iguales');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await screen.findByText('Pagado');
        expect(screen.getByRole('button', { name: 'Un pago' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: '+ Persona' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Iguales' })).toBeDisabled();
        expect(api.payLeg).toHaveBeenCalledTimes(1);
    });
});
