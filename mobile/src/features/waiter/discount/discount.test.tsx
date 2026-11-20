import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderScreen } from '../order/OrderScreen';
import { makeApi, makeDrafts, makeRealtime, orderOf, serverItem, userSession } from '../order/testkit';

const EDIT_ONLY = ['orders.view', 'orders.edit'];
const WITH_APPLY = ['orders.view', 'orders.edit', 'orders.discount.apply'];

/** Two lines of C$ 100: subtotal 200, 15 % tax. */
const twoLines = () => [serverItem(1, 1, 'Pizza Margarita', { price: '100.00', subtotal: '100.00' }), serverItem(2, 1, 'Pizza Margarita', { price: '100.00', subtotal: '100.00' })];
const baseOrder = (over: Record<string, unknown> = {}) => orderOf(twoLines(), { tax: '30.00', total: '230.00', discount: '0.00', ...over });

const authRequired = (limitPercent: number, requestedPercent: number) =>
    Object.assign(new Error('403'), { response: { status: 403, data: { success: false, code: 'DISCOUNT_AUTH_REQUIRED', message: 'x', limitPercent, requestedPercent } } });
const unauthorized = () => Object.assign(new Error('401'), { response: { status: 401, data: { success: false, message: 'Autorización inválida' } } });

function setup(opts: { api?: ReturnType<typeof makeApi>; permissions?: string[] } = {}) {
    const api = opts.api ?? makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder()) });
    const session = userSession(opts.permissions ?? WITH_APPLY);
    render(
        <OrderScreen
            session={session}
            api={api}
            drafts={makeDrafts()}
            realtime={makeRealtime()}
            queue={null}
            orderId={102}
            tableId={2}
            intent="view"
            invalidate={vi.fn().mockResolvedValue(undefined)}
            onBack={vi.fn()}
        />,
    );
    return { api, session };
}

const openSheet = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Descuento' }));
    return screen.findByRole('dialog', { name: 'Promociones y descuentos' });
};
const pick = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('discount sheet', () => {
    it('reason is required before applying', async () => {
        const { api } = setup();
        await openSheet();
        pick('10 %');
        pick('Aplicar descuento');
        expect(await screen.findByText('Elige un motivo.')).toBeInTheDocument();
        expect(api.pricing).not.toHaveBeenCalled();
        pick('Cortesía');
        pick('Aplicar descuento');
        await waitFor(() => expect(api.pricing).toHaveBeenCalledWith(102, { discount: 20, discountReason: 'Cortesía', discountCode: null }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Promociones y descuentos' })).toBeNull());
        expect(api.orderDetail.mock.calls.length).toBeGreaterThan(1); // the order was reloaded
    });

    it('shows the limit and the new total the server will compute', async () => {
        setup();
        const sheet = await openSheet();
        expect(await within(sheet).findByText('Tu límite: 10 %')).toBeInTheDocument();
        pick('10 %');
        // 200 - 20 = 180, 15 % tax = 27 -> 207
        expect(within(sheet).getAllByText('C$ 207').length).toBeGreaterThan(0);
    });

    it('over-limit opens supervisor auth with requested and limit', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder()), pricing: vi.fn().mockRejectedValue(authRequired(10, 20)) });
        setup({ api });
        await openSheet();
        pick('20 %');
        pick('Demora');
        pick('Aplicar descuento');
        const auth = await screen.findByRole('dialog', { name: 'Autorización de supervisor' });
        expect(within(auth).getByText('Se necesita autorización')).toBeInTheDocument();
        expect(within(auth).getByText('Solicitado 20 %')).toBeInTheDocument();
        expect(within(auth).getByText('Tu límite 10 %')).toBeInTheDocument();
        expect(await within(auth).findByRole('button', { name: 'Marta Lopez' })).toBeInTheDocument();
        expect(within(auth).getByRole('button', { name: 'Autorizar 20 %' })).toBeDisabled(); // no supervisor / PIN yet
    });

    async function toAuth(api: ReturnType<typeof makeApi>) {
        setup({ api });
        await openSheet();
        pick('20 %');
        pick('Demora');
        pick('Aplicar descuento');
        const auth = await screen.findByRole('dialog', { name: 'Autorización de supervisor' });
        fireEvent.click(await within(auth).findByRole('button', { name: 'Marta Lopez' }));
        return auth;
    }
    const type = (auth: HTMLElement, digits: string) => digits.split('').forEach((d) => fireEvent.click(within(auth).getByRole('button', { name: d })));

    it('wrong PIN shows the generic error and clears digits', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder()), pricing: vi.fn().mockRejectedValue(authRequired(10, 20)), authorizeDiscount: vi.fn().mockRejectedValue(unauthorized()) });
        const auth = await toAuth(api);
        type(auth, '9999');
        expect(within(auth).getByTestId('auth-dots')).toHaveAttribute('data-filled', '4');
        fireEvent.click(within(auth).getByRole('button', { name: 'Autorizar 20 %' }));
        expect(await within(auth).findByText('Autorización inválida')).toBeInTheDocument();
        expect(within(auth).getByTestId('auth-dots')).toHaveAttribute('data-filled', '0');
        expect(screen.queryByText(/9999/)).toBeNull();
    });

    it('successful authorization refreshes the order and keeps the current user', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder()), pricing: vi.fn().mockRejectedValue(authRequired(10, 20)) });
        const auth = await toAuth(api);
        const before = api.orderDetail.mock.calls.length;
        type(auth, '1234');
        fireEvent.click(within(auth).getByRole('button', { name: 'Autorizar 20 %' }));
        await waitFor(() => expect(api.authorizeDiscount).toHaveBeenCalledWith(102, { supervisorUserId: 31, pin: '1234', discount: 40, discountReason: 'Demora' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(api.orderDetail.mock.calls.length).toBeGreaterThan(before);
        expect(screen.getByLabelText('Usuario Ana Perez')).toBeInTheDocument(); // the waiter is still the active user
    });

    it('a double tap on Autorizar sends one request and the button stays disabled meanwhile', async () => {
        let release: (v: unknown) => void = () => undefined;
        const api = makeApi({
            orderDetail: vi.fn().mockResolvedValue(baseOrder()),
            pricing: vi.fn().mockRejectedValue(authRequired(10, 20)),
            authorizeDiscount: vi.fn().mockImplementation(() => new Promise((r) => (release = r))),
        });
        const auth = await toAuth(api);
        type(auth, '1234');
        const button = within(auth).getByRole('button', { name: 'Autorizar 20 %' });
        fireEvent.click(button);
        fireEvent.click(button);
        expect(api.authorizeDiscount).toHaveBeenCalledTimes(1);
        expect(button).toBeDisabled();
        await act(async () => release({}));
    });

    it('cancel clears the PIN and returns without authorizing', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder()), pricing: vi.fn().mockRejectedValue(authRequired(10, 20)) });
        const auth = await toAuth(api);
        type(auth, '1234');
        fireEvent.click(within(auth).getByRole('button', { name: 'Cancelar' }));
        expect(api.authorizeDiscount).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Autorización de supervisor' })).toBeNull();
        expect(screen.queryByTestId('auth-dots')).toBeNull();
    });

    it('requires a connection and says so', async () => {
        const { api } = setup();
        await openSheet();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        pick('10 %');
        pick('Cortesía');
        pick('Aplicar descuento');
        expect(await screen.findByText('Aplicar un descuento requiere conexión.')).toBeInTheDocument();
        expect(api.pricing).not.toHaveBeenCalled();
    });

    it('previews a coupon and applies it by code', async () => {
        const { api } = setup();
        await openSheet();
        fireEvent.change(screen.getByLabelText('Código de cupón'), { target: { value: 'promo10 ' } });
        pick('Validar');
        expect(await screen.findByText(/Cupón aplicado/)).toBeInTheDocument();
        expect(api.validateCoupon).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROMO10', orderTotal: 200 }));
        expect(api.pricing).not.toHaveBeenCalled(); // preview only
        pick('Aplicar cupón');
        await waitFor(() => expect(api.pricing).toHaveBeenCalledWith(102, { discountCode: 'PROMO10' }));
    });

    it('removes the current discount', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder({ discount: '20.00', discountReason: 'Cortesía', total: '207.00', tax: '27.00' })) });
        setup({ api });
        await openSheet();
        pick('Quitar descuento');
        await waitFor(() => expect(api.pricing).toHaveBeenCalledWith(102, { discount: 0, discountCode: null }));
    });

    it('the Descuento button follows orders.discount.apply or orders.edit (supervisor request path)', async () => {
        setup({ permissions: EDIT_ONLY });
        expect(await screen.findByRole('button', { name: 'Descuento' })).toBeInTheDocument();
        cleanup();
        setup({ permissions: ['orders.view'] });
        await screen.findByRole('region', { name: 'Productos' });
        expect(screen.queryByRole('button', { name: 'Descuento' })).toBeNull();
    });

    it('without orders.discount.apply the limit shown is 0 and discountLimit is not asked', async () => {
        const { api } = setup({ permissions: EDIT_ONLY });
        const sheet = await openSheet();
        expect(within(sheet).getByText('Tu límite: 0 %')).toBeInTheDocument();
        expect(api.discountLimit).not.toHaveBeenCalled();
    });

    it('the ticket footer shows subtotal, discount with its reason, and total', async () => {
        const api = makeApi({ orderDetail: vi.fn().mockResolvedValue(baseOrder({ discount: '20.00', discountReason: 'Cortesía', total: '207.00', tax: '27.00' })) });
        setup({ api });
        const ticket = await screen.findByRole('region', { name: 'Ticket' });
        await waitFor(() => expect(within(ticket).getByText('Subtotal')).toBeInTheDocument());
        expect(within(ticket).getByText('Cortesía')).toBeInTheDocument();
        expect(within(ticket).getByText('− C$ 20')).toBeInTheDocument();
        expect(within(ticket).getByText('C$ 207')).toBeInTheDocument();
    });

    it('layout fits 1024×600 without overflow', async () => {
        setup();
        const sheet = await openSheet();
        const fixedSum = (root: Element) => [...root.querySelectorAll('[data-fixed]')].reduce((n, el) => n + Number(el.getAttribute('data-fixed')), 0);
        const count = (root: Element) => root.querySelectorAll('[data-fixed]').length;
        const part = (name: string) => sheet.querySelector(`[data-part="${name}"]`)!;
        const chrome = Number(part('header').getAttribute('data-fixed')) + Number(part('footer').getAttribute('data-fixed'));
        const GAP = 10;
        const stack = (root: Element) => fixedSum(root) + GAP * (count(root) + 1);
        expect(chrome + stack(part('right'))).toBeLessThanOrEqual(600);
        expect(Number(part('left').getAttribute('data-width')) + 640).toBeLessThanOrEqual(1024); // left panel + a usable right panel
        // "Otro" keypad view
        fireEvent.click(within(within(sheet).getByRole('group', { name: 'Valores rápidos' })).getByRole('button', { name: /^Otro/ }));
        expect(within(sheet).getByRole('button', { name: 'Listo' })).toBeInTheDocument();
        expect(chrome + stack(part('right'))).toBeLessThanOrEqual(600);
        // the panels may scroll, the sheet itself never does
        expect(sheet).toHaveAttribute('data-no-page-scroll', 'true');
    });
});
