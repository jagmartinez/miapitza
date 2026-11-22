import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderScreen } from './OrderScreen';
import { FullTicketScreen } from './FullTicketScreen';
import { makeApi, makeDrafts, makeRealtime, minutesAgo, orderOf, serverItem, userSession, ALL_PERMISSIONS } from './testkit';

function setup(opts: { api?: ReturnType<typeof makeApi>; permissions?: string[]; drafts?: ReturnType<typeof makeDrafts> } = {}) {
    const api = opts.api ?? makeApi();
    const props = {
        session: userSession(opts.permissions ?? ALL_PERMISSIONS),
        api,
        drafts: opts.drafts ?? makeDrafts(),
        realtime: makeRealtime(),
        queue: null,
        orderId: 102,
        tableId: 2,
        intent: 'view' as const,
        invalidate: vi.fn().mockResolvedValue(undefined),
        onBack: vi.fn(),
        onPay: vi.fn(),
        onSplit: vi.fn(),
    };
    render(<OrderScreen {...props} />);
    return { ...props, api };
}

type Seed = Parameters<ReturnType<typeof makeDrafts>['set']>[2];
const seed = (items: Record<string, unknown>[]) => ({ items }) as unknown as Seed;
const ticket = () => screen.getByRole('region', { name: 'Ticket' });
const ready = (id: number, menuItemId: number, name: string, over = {}) => serverItem(id, menuItemId, name, { status: 'DONE', finishedAt: minutesAgo(4), ...over });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('long ticket', () => {
    it('renders 40 lines with the footer visible and only visible rows mounted', async () => {
        const drafts = makeDrafts();
        await drafts.set(
            '1:7',
            { orderId: 102 },
            seed(Array.from({ length: 40 }, (_, i) => ({ menuItemId: 100 + i, quantity: 1, name: `Plato ${i}`, unitPrice: 10 + i }))),
        );
        setup({ drafts });
        await within(ticket()).findByText('Plato 0');
        const rows = within(ticket()).getAllByTestId(/^draft-/);
        expect(rows.length).toBeGreaterThan(3);
        expect(rows.length).toBeLessThan(20); // 40 lines, a window of them mounted
        expect(within(ticket()).queryByText('Plato 39')).toBeNull();
        // footer lives outside the scrolling list: total and send are always there
        expect(within(ticket()).getByRole('button', { name: 'Enviar a cocina · 40' })).toBeVisible();
        expect(within(ticket()).getByRole('button', { name: 'Cobrar' })).toBeInTheDocument();
        // scrolling brings the later rows in
        const list = within(ticket()).getByTestId('ticket-list');
        list.scrollTop = 56 * 38;
        fireEvent.scroll(list);
        await within(ticket()).findByText('Plato 39');
        expect(within(ticket()).queryByText('Plato 0')).toBeNull();
    });

    it('only one row expanded at a time', async () => {
        const drafts = makeDrafts();
        await drafts.set('1:7', { orderId: 102 }, seed([{ menuItemId: 1, quantity: 1, name: 'Pizza', unitPrice: 100 }, { menuItemId: 2, quantity: 2, name: 'Cola', unitPrice: 30 }]));
        setup({ drafts });
        const first = await within(ticket()).findByRole('button', { name: /Pizza/ });
        fireEvent.click(first);
        expect(first).toHaveAttribute('aria-expanded', 'true');
        expect(within(ticket()).getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
        fireEvent.click(within(ticket()).getByRole('button', { name: /Cola/ }));
        expect(first).toHaveAttribute('aria-expanded', 'false');
        expect(ticket().querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
        expect(within(ticket()).getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
        // stepper edits the draft line
        fireEvent.click(within(ticket()).getByRole('button', { name: 'Más' }));
        expect(within(within(ticket()).getByTestId('draft-2||')).getAllByText('3').length).toBeGreaterThan(0);
    });

    it('editing an unsent server line uses updateItem and removing uses removeItem', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([serverItem(7, 1, 'Pizza', { sentAt: null, status: 'PENDING', quantity: 2 })]));
        setup({ api });
        const row = await within(ticket()).findByRole('button', { name: /Pizza/ });
        fireEvent.click(row);
        fireEvent.click(within(ticket()).getByRole('button', { name: 'Más' }));
        await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(7, { quantity: 3 }));
        fireEvent.click(within(ticket()).getByRole('button', { name: 'Quitar' }));
        await waitFor(() => expect(api.removeItem).toHaveBeenCalledWith(7));
    });

    it('Enviado card summarises the sent lines by state', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(
            orderOf([ready(1, 1, 'Pizza', { quantity: 2 }), serverItem(2, 2, 'Cola', { status: 'IN_PROGRESS' }), ready(3, 4, 'Ensalada', { deliveredAt: minutesAgo(1) })]),
        );
        setup({ api });
        const card = await within(ticket()).findByRole('button', { name: /Enviado · 4/ });
        expect(within(card).getByText('Listo · 2')).toBeInTheDocument();
        expect(within(card).getByText('En preparación · 1')).toBeInTheDocument();
        expect(within(card).getByText('Entregado · 1')).toBeInTheDocument();
    });
});

describe('ready to deliver', () => {
    const withReady = () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf([ready(5, 1, 'Pizza'), ready(6, 2, 'Cola', { quantity: 2 }), serverItem(8, 4, 'Ensalada')]));
        return api;
    };

    it('deliver all sends the ready item ids once', async () => {
        const api = withReady();
        setup({ api });
        const card = await screen.findByRole('region', { name: 'Listo para entregar' });
        expect(card).toHaveTextContent('Listo para entregar · 3 · hace 4 min');
        const all = within(card).getByRole('button', { name: 'Entregar todo · 3' });
        fireEvent.click(all);
        fireEvent.click(all);
        await waitFor(() => expect(api.deliverItems).toHaveBeenCalledTimes(1));
        expect(api.deliverItems).toHaveBeenCalledWith(102, [5, 6]);
        await waitFor(() => expect(api.orderDetail.mock.calls.length).toBeGreaterThan(1)); // refreshed
    });

    it('one product has its own 44 dp check', async () => {
        const api = withReady();
        setup({ api });
        const card = await screen.findByRole('region', { name: 'Listo para entregar' });
        fireEvent.click(within(card).getByRole('button', { name: 'Entregar Cola' }));
        await waitFor(() => expect(api.deliverItems).toHaveBeenCalledWith(102, [6]));
    });

    it('without orders.deliver there is no deliver action', async () => {
        const api = withReady();
        setup({ api, permissions: ['orders.view', 'orders.edit'] });
        await within(ticket()).findByText(/En cocina|Enviado/);
        expect(screen.queryByRole('region', { name: 'Listo para entregar' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Entregar/ })).toBeNull();
    });

    it('says delivering needs a connection when the order is not synced yet', async () => {
        const api = withReady();
        const { OrderNotSyncedError } = await import('../../../data/waiterApi');
        api.deliverItems.mockRejectedValue(new OrderNotSyncedError('order-1-abcd'));
        setup({ api });
        const card = await screen.findByRole('region', { name: 'Listo para entregar' });
        fireEvent.click(within(card).getByRole('button', { name: 'Entregar todo · 3' }));
        expect(await screen.findByText(/requiere conexión/i)).toBeInTheDocument();
    });
});

describe('full ticket', () => {
    async function openFull(api = makeApi()) {
        api.orderDetail.mockResolvedValue(
            orderOf([ready(5, 1, 'Pizza'), serverItem(6, 2, 'Cola', { quantity: 2, status: 'IN_PROGRESS' }), ready(7, 4, 'Ensalada', { deliveredAt: minutesAgo(1) }), serverItem(8, 2, 'Agua', { sentAt: null })]),
        );
        const drafts = makeDrafts();
        await drafts.set('1:7', { orderId: 102 }, seed([{ menuItemId: 1, quantity: 1, name: 'Pan', unitPrice: 20 }]));
        const view = setup({ api, drafts });
        fireEvent.click(await within(ticket()).findByRole('button', { name: /Enviado · 4/ }));
        const full = await screen.findByRole('region', { name: 'Ticket completo' });
        return { ...view, full };
    }

    it('full ticket filters show counts', async () => {
        const { full } = await openFull();
        const filters = within(full).getByRole('group', { name: 'Filtros' });
        const names = within(filters)
            .getAllByRole('button')
            .map((b) => b.textContent);
        expect(names).toEqual(['Todo6', 'Nuevo2', 'Listos1', 'En preparación2', 'Entregados1']);
        fireEvent.click(within(filters).getByRole('button', { name: /Listos/ }));
        expect(within(full).getByText('Pizza')).toBeInTheDocument();
        expect(within(full).queryByText('Cola')).toBeNull();
        expect(within(filters).getByRole('button', { name: /Listos/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('ready line action is a button, never a text link', async () => {
        const { full, api } = await openFull();
        const action = within(full).getByRole('button', { name: 'Entregar Pizza' });
        expect(action.tagName).toBe('BUTTON');
        expect(full.querySelector('a')).toBeNull();
        expect(within(full).queryAllByRole('link')).toHaveLength(0);
        fireEvent.click(action);
        await waitFor(() => expect(api.deliverItems).toHaveBeenCalledWith(102, [5]));
    });

    it('footer delivers the ready ones and sends to the kitchen', async () => {
        const { full, api } = await openFull();
        fireEvent.click(within(full).getByRole('button', { name: 'Entregar listos · 1' }));
        await waitFor(() => expect(api.deliverItems).toHaveBeenCalledWith(102, [5]));
        expect(within(full).getByRole('button', { name: 'Enviar a cocina · 2' })).toBeEnabled(); // Pan (draft) + Agua (server, unsent)
        expect(within(full).getByRole('button', { name: 'Cobrar' })).toBeInTheDocument();
        expect(within(full).getByRole('button', { name: 'Dividir' })).toBeInTheDocument();
        fireEvent.click(within(full).getByRole('button', { name: 'Volver al pedido' }));
        expect(screen.queryByRole('region', { name: 'Ticket completo' })).toBeNull();
    });
});

describe('full ticket fixes', () => {
    const baseProps = {
        title: 'Mesa 2',
        drafts: [],
        canEdit: true,
        canDeliver: true,
        busy: false,
        sendCount: 0,
        sending: false,
        error: null,
        onDeliver: vi.fn(),
        onSend: vi.fn(),
        onBack: vi.fn(),
    };
    const line = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, menuItemId: id, name, quantity: 1, unitPrice: 50, subtotal: 50, notes: '', modifiers: [], state: 'preparing' as const, finishedAt: null, sentAt: null, ...over });
    const noActions = { canPay: false, canSplit: false, canDiscount: false };

    it('M-3: ages tick without new data', () => {
        vi.useFakeTimers();
        try {
            const sentAt = new Date(Date.now() - 2 * 60_000).toISOString();
            render(<FullTicketScreen {...baseProps} serverLines={[line(1, 'Pizza', { sentAt })]} actions={noActions} />);
            expect(screen.getByText('Preparando · 2 min')).toBeInTheDocument();
            act(() => {
                vi.advanceTimersByTime(3 * 60_000);
            });
            expect(screen.getByText('Preparando · 5 min')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('M-4: groups sends by kitchen batch, even inside the same minute', () => {
        const sentAt = new Date(Date.now() - 5 * 60_000).toISOString();
        render(<FullTicketScreen {...baseProps} serverLines={[line(1, 'Pizza', { sentAt, kitchenBatchId: 1 }), line(2, 'Cola', { sentAt, kitchenBatchId: 2 })]} actions={noActions} />);
        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.slice(0, 7))).toEqual(['Envío 2', 'Envío 1']);
    });

    it('M-5: Más acciones sheet has a title and close button; Descuento is reachable from the full ticket', () => {
        const onDiscount = vi.fn();
        render(<FullTicketScreen {...baseProps} serverLines={[]} actions={{ ...noActions, canDiscount: true, onDiscount }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
        const sheet = screen.getByRole('dialog', { name: 'Más acciones' });
        expect(within(sheet).getByRole('heading', { name: 'Más acciones' })).toBeInTheDocument();
        fireEvent.click(within(sheet).getByRole('button', { name: 'Descuento' }));
        expect(onDiscount).toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Más acciones' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Más acciones' })).getByRole('button', { name: 'Cerrar' }));
        expect(screen.queryByRole('dialog', { name: 'Más acciones' })).toBeNull();
    });
});

describe('ticket fix round 1', () => {
    it('I6: expanding the last visible row scrolls it into view', async () => {
        const drafts = makeDrafts();
        await drafts.set('1:7', { orderId: 102 }, seed(Array.from({ length: 12 }, (_, i) => ({ menuItemId: 100 + i, quantity: 1, name: `Plato ${i}`, unitPrice: 10 }))));
        setup({ drafts });
        const list = await within(ticket()).findByTestId('ticket-list');
        const row = await within(ticket()).findByRole('button', { name: /Plato 7/ });
        expect(list.scrollTop).toBe(0);
        fireEvent.click(row);
        await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
        expect(within(ticket()).getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    });

    it('Minor 10: 40 server lines mount only a window and keep the footer', async () => {
        const api = makeApi();
        api.orderDetail.mockResolvedValue(orderOf(Array.from({ length: 40 }, (_, i) => serverItem(200 + i, 1, `Linea ${i}`, { sentAt: null, status: 'PENDING' }))));
        setup({ api });
        await within(ticket()).findByText('Linea 0');
        expect(within(ticket()).getAllByTestId(/^unsent-/).length).toBeLessThan(20);
        expect(within(ticket()).getByRole('button', { name: 'Enviar a cocina · 40' })).toBeVisible();
    });
});
