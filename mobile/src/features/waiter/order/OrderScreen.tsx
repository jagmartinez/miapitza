import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { can } from '../../../core/permissions';
import type { Realtime } from '../../../core/realtime';
import type { Session } from '../../../core/session';
import type { Drafts } from '../../../data/drafts';
import type { OfflineQueue } from '../../../data/offlineQueue';
import { OfflineIndicator } from '../../../data/OfflineIndicator';
import { ownerKeyOf } from '../../../data/types';
import type { OrderRef, WaiterApi } from '../../../data/waiterApi';
import type { OrderIntent } from '../tables/TablesScreen';
import { CategoryRail } from './CategoryRail';
import { ModifierSheet, type ModifierChoice } from './ModifierSheet';
import { ProductGrid } from './ProductGrid';
import { TicketPanel } from './TicketPanel';
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
import '../tables/sheets.css';

export type OrderApi = Pick<
    WaiterApi,
    'menu' | 'menuItem' | 'categories' | 'topSellers' | 'promotions' | 'orderDetail' | 'activeOrders' | 'addItem' | 'sendToKitchen' | 'createOrder' | 'updateItem' | 'removeItem' | 'deliverItems'
>;

export interface OrderScreenProps {
    session: Session;
    api: OrderApi;
    drafts: Drafts;
    realtime: Pick<Realtime, 'subscribe'>;
    queue: OfflineQueue | null;
    orderId: OrderRef;
    /** Needed for an order that exists only in the offline queue; otherwise read from the order. */
    tableId?: number;
    intent?: OrderIntent;
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

type SheetState = { product: Product; groups: ModifierGroup[] } | null;

export function OrderScreen(props: OrderScreenProps) {
    const { session, api, drafts, realtime, queue, orderId, intent, onBack, onPay, onSplit, onDiscount, onMore } = props;
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

    const alive = useRef(true);
    const seq = useRef(0);
    const payHandled = useRef(false);

    const tableId = props.tableId ?? (typeof order?.tableId === 'number' ? order.tableId : (order?.table?.id ?? null));
    const canEdit = can(user, 'orders.edit');

    // ---- order ----
    const loadOrder = useCallback(async () => {
        if (isTemp(orderId)) return; // created offline: nothing on the server to read yet
        const mine = ++seq.current;
        try {
            const detail = await api.orderDetail(Number(orderId));
            let lines = normalizeServerLines(detail);
            // GET /orders/:id omits modifiers; the active list carries them.
            if (branchId != null) {
                try {
                    const active = await api.activeOrders(branchId);
                    const mine2 = (active.data as Json[]).find((o) => o.id === detail.id);
                    const names = new Map<number, string[]>(normalizeServerLines(mine2).map((l) => [l.id, l.modifiers]));
                    lines = lines.map((l) => (l.modifiers.length === 0 && names.get(l.id)?.length ? { ...l, modifiers: names.get(l.id)! } : l));
                } catch {
                    // modifiers are decoration; the order itself loaded
                }
            }
            if (!alive.current || mine !== seq.current) return;
            setOrder(detail);
            setServerLines(lines);
            setNow(Date.now());
            setNotice(null);
        } catch (cause) {
            if (alive.current && mine === seq.current) setNotice(getApiErrorMessage(cause));
        }
    }, [api, orderId, branchId]);

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

    const promoMap = useMemo(() => promoLabels(promos, products), [promos, products]);
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
        guests: typeof order?.guests === 'number' ? order.guests : undefined,
        serverUnsent: sumQuantity(unsentOnServer),
        onSent: () => void loadOrder(),
    });

    const quantities = useMemo(() => {
        const map = new Map<number, number>();
        for (const l of draft.lines) map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.quantity);
        for (const l of serverLines) map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.quantity);
        return map;
    }, [draft.lines, serverLines]);

    // ---- product actions ----
    const groupsFor = async (product: Product): Promise<ModifierGroup[]> => {
        if (product.modifierGroups === 0) return [];
        try {
            return normalizeModifierGroups((await api.menuItem(product.id)).data);
        } catch (cause) {
            setNotice(getApiErrorMessage(cause));
            return [];
        }
    };

    const tap = async (product: Product) => {
        if (!draft.loaded) return;
        const groups = await groupsFor(product);
        if (groups.some((g) => g.minSelect >= 1)) setSheet({ product, groups });
        else draft.add(product);
    };
    const hold = async (product: Product) => {
        if (!draft.loaded) return;
        setSheet({ product, groups: await groupsFor(product) });
    };
    const confirmSheet = (choice: ModifierChoice) => {
        if (sheet) draft.add(sheet.product, choice);
        setSheet(null);
    };

    // intent 'pay': go straight to the payment once the order is on screen
    useEffect(() => {
        if (intent === 'pay' && order && !payHandled.current && onPay && can(user, 'payments.process')) {
            payHandled.current = true;
            onPay();
        }
    }, [intent, order, onPay, user]);

    const productCount = sumQuantity(serverLines) + draft.count;
    const sentTotal = Number(order?.total) || 0;
    const elapsed = order?.createdAt ? `${minutesSince(order.createdAt, now)} min` : '';
    const tableLabel = order?.table?.number ? `Mesa ${order.table.number}` : 'Mesa';
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
                <span className="avatar-disc small" title={user.name} aria-label={`Usuario ${user.name}`}>
                    {initials}
                </span>
            </header>
            {(menuError || notice) && (
                <p className="error pos-notice" role="alert">
                    {menuError ?? notice}
                </p>
            )}
            <div className="pos-body">
                <CategoryRail entries={rail} selected={current} onSelect={(id) => { setSelected(id); setSearch(''); }} />
                <ProductGrid products={shown} quantities={quantities} promos={promoMap} disabled={!canEdit || !draft.loaded} onTap={(p) => void tap(p)} onHold={(p) => void hold(p)} />
                <TicketPanel
                    title="Ticket"
                    subtitle={`${tableLabel}${guests != null ? ` · ${guests} pers` : ''} · ${productCount} productos`}
                    drafts={draft.lines}
                    highlightKey={draft.highlightKey}
                    serverLines={serverLines}
                    total={sentTotal + draft.total}
                    sendCount={draft.sendCount}
                    sending={draft.sending}
                    error={draft.error}
                    canEdit={canEdit}
                    onQuantity={draft.setQuantity}
                    onSend={() => void draft.send()}
                    actions={{
                        canSend: canEdit,
                        canPay: can(user, 'payments.process'),
                        canSplit: can(user, 'bills.split'),
                        canDiscount: can(user, 'orders.discount.apply'),
                        onPay,
                        onSplit,
                        onDiscount,
                        onMore,
                    }}
                />
            </div>
            {sheet && <ModifierSheet product={sheet.product} groups={sheet.groups} onConfirm={confirmSheet} onClose={() => setSheet(null)} />}
        </main>
    );
}
