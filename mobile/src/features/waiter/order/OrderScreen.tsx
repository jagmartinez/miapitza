import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { can } from '../../../core/permissions';
import type { Realtime } from '../../../core/realtime';
import type { Session } from '../../../core/session';
import type { Drafts } from '../../../data/drafts';
import type { PaymentPlans } from '../../../data/paymentPlans';
import type { OfflineQueue, QueuedLine } from '../../../data/offlineQueue';
import { OfflineIndicator } from '../../../data/OfflineIndicator';
import { ownerKeyOf } from '../../../data/types';
import { isOnline } from '../../../data/useOnline';
import type { OrderRef, WaiterApi } from '../../../data/waiterApi';
import type { PaymentApi } from '../payment/PaymentScreen';
import type { OrderIntent } from '../tables/TablesScreen';
import { CategoryRail } from './CategoryRail';
import { FullTicketScreen } from './FullTicketScreen';
import { ModifierSheet, type ModifierChoice } from './ModifierSheet';
import { ProductGrid } from './ProductGrid';
import { TicketPanel, type TicketPricing } from './TicketPanel';
import {
    buildRail,
    minutesSince,
    normalizeModifierGroups,
    normalizeProducts,
    normalizeServerLines,
    productsFor,
    promoLabels,
    sumQuantity,
    type ModifierGroup,
    type Product,
    type RailEntry,
    type ServerLine,
} from './orderModel';
import { useOrderDraft } from './useOrderDraft';
import './order.css';
import './ticket.css';
import '../tables/sheets.css';

export type OrderApi = Pick<
    WaiterApi,
    'menu' | 'menuItem' | 'categories' | 'topSellers' | 'promotions' | 'orderDetail' | 'activeOrders' | 'addItem' | 'sendToKitchen' | 'createOrder' | 'updateItem' | 'removeItem' | 'deliverItems' | 'pricing' | 'authorizeDiscount' | 'supervisors' | 'discountLimit' | 'validateCoupon'
> &
    PaymentApi;

export interface OrderScreenProps {
    session: Session;
    api: OrderApi;
    drafts: Drafts;
    /** In-progress payment plans (keys of attempted legs); without it a plan only lives while the payment screen is open. */
    plans?: PaymentPlans;
    realtime: Pick<Realtime, 'subscribe'>;
    queue: OfflineQueue | null;
    orderId: OrderRef;
    /** Needed for an order that exists only in the offline queue; otherwise read from the order. */
    tableId?: number;
    /** Label of the table ("5"): an order that only exists in the queue has no server order to read it from. */
    tableNumber?: string;
    intent?: OrderIntent;
    /** Other orders of this session that are ready: a small badge in the header, tapping it goes back to the tables. */
    readyCount?: number;
    invalidate?: () => Promise<void>;
    onBack: () => void;
    onPay?: () => void;
    onSplit?: () => void;
    onDiscount?: () => void;
    onMore?: () => void;
}

const LIVE_EVENTS = ['ORDER_UPDATE', 'ORDER_READY', 'KITCHEN_NOTIFICATION', 'TABLE_STATUS_CHANGED'] as const;
const REFETCH_DEBOUNCE_MS = 300;
const CLOCK_TICK_MS = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const isTemp = (id: OrderRef) => typeof id === 'string' && !/^\d+$/.test(id);

// Discount UI (sheet, keypad, supervisor screen) is only needed when the button is tapped.
const DiscountSheet = lazy(() => import('../discount/DiscountSheet').then((m) => ({ default: m.DiscountSheet })));

// Payment (three modes, keypad, split cards) is only needed when the cashier taps Cobrar.
const PaymentScreen = lazy(() => import('../payment/PaymentScreen'));

type SheetState = { product: Product; groups: ModifierGroup[] } | null;

export function OrderScreen(props: OrderScreenProps) {
    const { session, api, drafts, realtime, queue, intent, onBack, onPay, onSplit, onDiscount, onMore } = props;
    const user = session.user;
    const branchId = user.branchId;
    const ownerKey = ownerKeyOf(session);

    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<unknown>([]);
    const [topIds, setTopIds] = useState<number[]>([]);
    const [promos, setPromos] = useState<unknown>([]);
    const [menuError, setMenuError] = useState<string | null>(null);
    const [order, setOrder] = useState<Json | null>(null);
    const [serverLines, setServerLines] = useState<ServerLine[]>([]);
    const [selected, setSelected] = useState<RailEntry['id'] | null>(null);
    const [search, setSearch] = useState('');
    const [sheet, setSheet] = useState<SheetState>(null);
    const [now, setNow] = useState(() => Date.now());
    const [notice, setNotice] = useState<string | null>(null);
    // The order on screen came from the saved active list, not from the server.
    const [savedData, setSavedData] = useState(false);
    const [queuedLines, setQueuedLines] = useState<QueuedLine[]>([]);
    const orderLoaded = useRef(false);

    const alive = useRef(true);
    const seq = useRef(0);
    const payHandled = useRef(false);
    const busyRef = useRef(false);
    const loadingIds = useRef(new Set<number>());
    const [loadingId, setLoadingId] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [full, setFull] = useState(false);
    const [discountOpen, setDiscountOpen] = useState(false);
    const [payment, setPayment] = useState<'single' | 'split' | null>(null);

    // An order created offline carries a temp id until its create syncs; then the real order takes over.
    const [resolvedId, setResolvedId] = useState<number | null>(null);
    const orderId: OrderRef = resolvedId ?? props.orderId;
    const tableId = props.tableId ?? (typeof order?.tableId === 'number' ? order.tableId : (order?.table?.id ?? null));
    const canEdit = can(user, 'orders.edit');
    const canDeliver = can(user, 'orders.deliver');

    useEffect(() => {
        const temp = props.orderId;
        if (!queue || !isTemp(temp)) return undefined;
        let live = true;
        const check = async () => {
            const real = await queue.resolveTemp(String(temp));
            if (live && real != null && /^\d+$/.test(String(real))) setResolvedId(Number(real));
        };
        void check();
        const off = queue.onSynced(() => void check());
        return () => {
            live = false;
            off();
        };
    }, [queue, props.orderId]);

    // Lines sent while offline are not on the server yet: the ticket still has to show them.
    useEffect(() => {
        if (!queue?.queuedLines) return undefined;
        let live = true;
        const refresh = () => {
            queue.queuedLines(orderId).then(
                (lines) => live && setQueuedLines(lines),
                () => undefined,
            );
        };
        refresh();
        const off = queue.subscribe(refresh);
        const offSynced = queue.onSynced?.((item) => {
            refresh();
            if (item.operationType !== 'CREATE_ORDER') void loadOrderRef.current();
        });
        return () => {
            live = false;
            off();
            offSynced?.();
        };
    }, [queue, orderId]);

    // ---- order ----
    const loadOrder = useCallback(async (): Promise<boolean | undefined> => {
        if (isTemp(orderId)) return undefined; // created offline and not synced yet: nothing on the server to read
        const mine = ++seq.current;
        // The active list is cached (TTL) and carries modifiers; it is also the offline fallback for the order itself.
        const readActive = async (): Promise<Json[] | null> => {
            if (branchId == null) return null;
            try {
                return (await api.activeOrders(branchId)).data as Json[];
            } catch {
                return null;
            }
        };
        try {
            const detail = await api.orderDetail(Number(orderId));
            let lines = normalizeServerLines(detail);
            // GET /orders/:id omits modifiers.
            if (lines.length > 0) {
                const active = await readActive();
                const names = new Map<number, string[]>(normalizeServerLines(active?.find((o) => o.id === detail.id)).map((l) => [l.id, l.modifiers]));
                lines = lines.map((l) => (l.modifiers.length === 0 && names.get(l.id)?.length ? { ...l, modifiers: names.get(l.id)! } : l));
            }
            if (!alive.current || mine !== seq.current) return;
            orderLoaded.current = true;
            setOrder(detail);
            setServerLines(lines);
            setSavedData(false);
            setNow(Date.now());
            setNotice(null);
            return true;
        } catch (cause) {
            // Only the very first load may fall back to the saved active list; an order already on screen is never
            // replaced by an older snapshot (it would hide lines that were just added).
            const fallback = orderLoaded.current ? undefined : (await readActive())?.find((o) => o.id === Number(orderId));
            if (!alive.current || mine !== seq.current) return;
            if (fallback) {
                orderLoaded.current = true;
                setOrder(fallback);
                setServerLines(normalizeServerLines(fallback));
                setSavedData(true);
            } else {
                setNotice(getApiErrorMessage(cause));
            }
            return false;
        }
    }, [api, orderId, branchId]);

    const loadOrderRef = useRef(loadOrder);
    loadOrderRef.current = loadOrder;

    useEffect(() => {
        alive.current = true;
        void loadOrder();
        return () => {
            alive.current = false;
        };
    }, [loadOrder]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onEvent = (payload: unknown) => {
            const p = (payload ?? {}) as { orderId?: unknown };
            if (typeof p.orderId === 'number' && p.orderId !== Number(orderId)) return; // another table
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                void loadOrder();
            }, REFETCH_DEBOUNCE_MS);
        };
        const unsubs = LIVE_EVENTS.map((type) => realtime.subscribe(type, onEvent));
        return () => {
            if (timer) clearTimeout(timer);
            unsubs.forEach((u) => u?.());
        };
    }, [realtime, loadOrder, orderId]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);

    // ---- catalog (cache first; refreshed in the background) ----
    useEffect(() => {
        if (branchId == null) return undefined;
        let live = true;
        api.menu(branchId, (d) => live && setProducts(normalizeProducts(d))).then(
            (res) => live && setProducts(normalizeProducts(res.data)),
            (cause) => live && setMenuError(getApiErrorMessage(cause)),
        );
        // Optional pieces: the menu works without them.
        api.categories().then((r) => live && setCategories(r.data), () => undefined);
        api.topSellers(branchId, { limit: 12 }).then(
            (r) => live && setTopIds((r.data ?? []).map((t: Json) => t.menuItemId).filter((id: unknown): id is number => typeof id === 'number')),
            () => undefined,
        );
        api.promotions(branchId).then((r) => live && setPromos(r.data), () => undefined);
        return () => {
            live = false;
        };
    }, [api, branchId]);

    const promoMap = useMemo(() => promoLabels(promos, products, branchId), [promos, products, branchId]);
    const promoIds = useMemo(() => new Set(promoMap.keys()), [promoMap]);
    const rail = useMemo(() => buildRail({ categories, products, topIds, promoIds }), [categories, products, topIds, promoIds]);
    const current = rail.find((r) => r.id === selected)?.id ?? rail[0]?.id ?? null;

    const needle = search.trim().toLowerCase();
    const shown = useMemo(() => {
        if (needle) return products.filter((p) => p.name.toLowerCase().includes(needle));
        return current == null ? [] : productsFor(current, products, topIds, promoIds);
    }, [needle, products, current, topIds, promoIds]);

    // ---- draft ----
    const unsentOnServer = serverLines.filter((l) => l.state === 'new');
    const draft = useOrderDraft({
        drafts,
        api,
        ownerKey,
        tableId,
        orderId,
        // the draft belongs to this order only if it was written after the order opened
        orderCreatedAt: order?.createdAt ? Date.parse(String(order.createdAt)) || null : undefined,
        guests: typeof order?.guests === 'number' ? order.guests : undefined,
        serverUnsent: sumQuantity(unsentOnServer),
        onSent: () => void loadOrder(),
        onChanged: () => void loadOrder(), // a failed send may have left lines on the server
    });

    const quantities = useMemo(() => {
        const map = new Map<number, number>();
        for (const l of draft.lines) map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.quantity);
        for (const l of serverLines) map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.quantity);
        return map;
    }, [draft.lines, serverLines]);

    // ---- product actions ----
    /** null = the groups could not be loaded: a product that may require a modifier is never added blind. */
    const groupsFor = async (product: Product): Promise<ModifierGroup[] | null> => {
        if (product.modifierGroups === 0) return [];
        try {
            return normalizeModifierGroups((await api.menuItem(product.id)).data);
        } catch (cause) {
            setNotice(`No se pudieron cargar las opciones de ${product.name}. ${getApiErrorMessage(cause)}`);
            return null;
        }
    };

    /** One lookup per product at a time: a double tap neither refetches nor stacks two sheets. */
    const withGroups = async (product: Product, then: (groups: ModifierGroup[]) => void) => {
        if (!draft.loaded || loadingIds.current.has(product.id)) return;
        loadingIds.current.add(product.id);
        setLoadingId(product.id);
        try {
            const groups = await groupsFor(product);
            if (groups) then(groups);
        } finally {
            loadingIds.current.delete(product.id);
            setLoadingId(null);
        }
    };
    const tap = async (product: Product) => {
        if (product.modifierGroups === 0) {
            if (draft.loaded) draft.add(product);
            return;
        }
        await withGroups(product, (groups) => {
            if (groups.some((g) => g.minSelect >= 1)) setSheet({ product, groups });
            else draft.add(product);
        });
    };
    const hold = (product: Product) => withGroups(product, (groups) => setSheet({ product, groups }));
    const confirmSheet = (choice: ModifierChoice) => {
        if (sheet) draft.add(sheet.product, choice);
        setSheet(null);
    };

    /**
     * Payment is taken by the cashier (payments.process + invoices.issue; a waiter never sees Cobrar) and needs the live,
     * synced order: no connection, an order still in the offline queue, unsent products or an empty order never open it.
     */
    const canPay = can(user, 'payments.process') && can(user, 'invoices.issue');
    const openPayment = (mode: 'single' | 'split') => {
        if (!canPay) return;
        if (isTemp(orderId)) setNotice('Sincronizando pedido… cobrar requiere conexión.');
        else if (!isOnline()) setNotice('Cobrar requiere conexión.');
        else if (draft.count > 0 || unsentOnServer.length > 0) setNotice('Envía a cocina los productos nuevos antes de cobrar.');
        else if (serverLines.length === 0) setNotice('No hay productos para cobrar.');
        else {
            setNotice(null);
            setPayment(mode);
        }
    };
    const paymentClosed = () => {
        setPayment(null);
        void loadOrder(); // legs confirmed before leaving show in the ticket
    };
    const paymentFinished = async () => {
        await props.invalidate?.(); // the server already freed the table on full payment: only the saved lists are stale
        onBack();
    };

    // intent 'pay': go straight to the payment once the order and the draft are on screen
    useEffect(() => {
        if (intent === 'pay' && order && draft.loaded && !payHandled.current && canPay) {
            payHandled.current = true;
            if (onPay) onPay();
            else openPayment('single');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the order first shows
    }, [intent, order, draft.loaded, canPay]);

    /** One server mutation at a time (deliver, edit an unsent server line): a double tap never repeats it. */
    const run = async (action: () => Promise<string | void>, needsConnection: string) => {
        if (busyRef.current) return;
        if (!isOnline()) {
            setNotice(needsConnection);
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setNotice(null);
        try {
            const message = await action();
            await loadOrder();
            if (message) setNotice(message);
        } catch (cause) {
            const notSynced = cause instanceof Error && cause.name === 'OrderNotSyncedError';
            setNotice(notSynced ? `${needsConnection} El pedido aún se está sincronizando.` : getApiErrorMessage(cause));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };
    const deliver = (ids: number[]) =>
        void run(async () => {
            const res = await api.deliverItems(orderId, ids);
            const skipped = (res as { skipped?: number[] } | null)?.skipped?.length ?? 0;
            return skipped > 0 ? `${skipped} no estaban listos.` : undefined;
        }, 'Entregar requiere conexión.');
    const editConn = 'Editar el pedido requiere conexión.';
    const serverQuantity = (l: ServerLine, q: number) => void run(async () => void (await (q <= 0 ? api.removeItem(l.id) : api.updateItem(l.id, { quantity: q }))), editConn);
    const serverNote = (l: ServerLine, note: string) => void run(async () => void (await api.updateItem(l.id, { notes: note.trim() })), editConn);
    const serverRemove = (l: ServerLine) => void run(async () => void (await api.removeItem(l.id)), editConn);

    /** Discounts need the live order: an unsynced temp order or no connection never opens the sheet. */
    const openDiscount = () => {
        if (isTemp(orderId)) setNotice('Sincronizando pedido… los descuentos requieren conexión.');
        else if (!isOnline()) setNotice('Requiere conexión para aplicar descuentos.');
        else setDiscountOpen(true);
    };
    const discountApplied = async () => {
        if ((await loadOrder()) === false) setNotice('Descuento aplicado, pero no se pudo actualizar el pedido. Revisa el total.');
    };

    const actions = {
        canPay,
        canSplit: canPay && can(user, 'bills.split'), // Dividir ends in payments the waiter cannot take
        // Every discount route requires orders.edit; orders.discount.apply only decides direct vs supervisor-authorized.
        canDiscount: can(user, 'orders.edit'),
        onPay: onPay ?? (() => openPayment('single')),
        onSplit: onSplit ?? (() => openPayment('split')),
        onDiscount: onDiscount ?? openDiscount,
        onMore,
    };
    const productCount = sumQuantity(serverLines) + draft.count + queuedLines.reduce((n, l) => n + l.quantity, 0);
    const sentTotal = Number(order?.total) || 0;
    const orderDiscount = Number(order?.discount) || 0;
    const pricing: TicketPricing = {
        subtotal: serverLines.reduce((n, l) => n + l.subtotal, 0),
        discount: orderDiscount,
        tax: order?.tax != null ? Number(order.tax) || 0 : null,
        tip: Number(order?.tipAmount) || 0,
        label: orderDiscount > 0 ? (order?.discountCode ? `Cupón ${String(order.discountCode)}` : String(order?.discountReason || 'Manual')) : null,
    };
    const elapsed = order?.createdAt ? `${minutesSince(order.createdAt, now)} min` : '';
    const tableLabel = order?.table?.number ? `Mesa ${order.table.number}` : props.tableNumber ? `Mesa ${props.tableNumber}` : 'Mesa';
    const guests = typeof order?.guests === 'number' ? order.guests : null;
    const initials = user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');

    return (
        <main className="pos" data-testid="pos-screen" data-order-id={String(orderId)}>
            <header className="pos-bar">
                <button type="button" className="btn" aria-label="Volver a mesas" onClick={onBack}>
                    ←
                </button>
                <strong className="pos-table">{tableLabel}</strong>
                {guests != null && <span className="muted">{`${guests} pers`}</span>}
                {elapsed && <span className="muted">{elapsed}</span>}
                {isTemp(orderId) && <span className="muted">Sincronizando…</span>}
                <input className="pos-search" type="search" aria-label="Buscar producto" placeholder="Buscar producto" value={search} onChange={(e) => setSearch(e.target.value)} />
                <OfflineIndicator queue={queue} />
                {(props.readyCount ?? 0) > 0 && (
                    <button type="button" className="chip ready-chip" aria-label={`Pedidos listos: ${props.readyCount}`} onClick={onBack}>
                        <span className="ready-dot" aria-hidden="true" />
                        {props.readyCount}
                    </button>
                )}
                <span className="avatar-disc small" title={user.name} aria-label={`Usuario ${user.name}`}>
                    {initials}
                </span>
            </header>
            {savedData && !notice && <p className="muted pos-notice">Sin conexión · datos guardados</p>}
            {(menuError || notice) && (
                <p className="error pos-notice" role="alert">
                    {menuError ?? notice}
                </p>
            )}
            <div className="pos-body">
                <CategoryRail entries={rail} selected={current} onSelect={(id) => { setSelected(id); setSearch(''); }} />
                <ProductGrid products={shown} quantities={quantities} promos={promoMap} disabled={!canEdit || !draft.loaded || draft.sending} busyId={loadingId} onTap={(p) => void tap(p)} onHold={(p) => void hold(p)} />
                <TicketPanel
                    title="Ticket"
                    subtitle={`${tableLabel}${guests != null ? ` · ${guests} pers` : ''} · ${productCount} productos`}
                    drafts={draft.lines}
                    highlightKey={draft.highlightKey}
                    serverLines={serverLines}
                    queued={queuedLines}
                    now={now}
                    total={sentTotal}
                    pricing={pricing}
                    unsentTotal={draft.total}
                    highlightSeq={draft.highlightSeq}
                    sendCount={draft.sendCount}
                    sending={draft.sending}
                    error={draft.error}
                    canEdit={canEdit}
                    canDeliver={canDeliver}
                    busy={busy}
                    onQuantity={draft.setQuantity}
                    onDraftNote={draft.setNote}
                    onServerQuantity={serverQuantity}
                    onServerNote={serverNote}
                    onServerRemove={serverRemove}
                    onDeliver={deliver}
                    onSend={() => void draft.send()}
                    onOpenFull={() => setFull(true)}
                    actions={actions}
                />
            </div>
            {full && (
                <FullTicketScreen
                    title={`${tableLabel}${guests != null ? ` · ${guests} pers` : ''}`}
                    drafts={draft.lines}
                    serverLines={serverLines}
                    queued={queuedLines}
                    canEdit={canEdit}
                    canDeliver={canDeliver}
                    busy={busy}
                    sendCount={draft.sendCount}
                    sending={draft.sending}
                    error={draft.error ?? notice}
                    actions={actions}
                    onDeliver={deliver}
                    onSend={() => void draft.send()}
                    onBack={() => setFull(false)}
                />
            )}
            {discountOpen && (
                <Suspense fallback={null}>
                    <DiscountSheet
                        api={api}
                        user={user}
                        orderId={orderId}
                        branchId={branchId ?? null}
                        order={order}
                        lines={serverLines}
                        promotions={promos}
                        onClose={() => setDiscountOpen(false)}
                        onApplied={discountApplied}
                    />
                </Suspense>
            )}
            {payment && (
                <Suspense fallback={<main className="pay" data-testid="payment-screen"><p className="muted pay-notice">Cargando cobro…</p></main>}>
                    <PaymentScreen api={api} user={user} orderId={orderId} plans={props.plans} ownerKey={ownerKey} initialMode={payment} onClose={paymentClosed} onFinished={paymentFinished} />
                </Suspense>
            )}
            {sheet && <ModifierSheet product={sheet.product} groups={sheet.groups} onConfirm={confirmSheet} onClose={() => setSheet(null)} />}
        </main>
    );
}
