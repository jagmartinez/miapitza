import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { can } from '../../../core/permissions';
import type { Realtime } from '../../../core/realtime';
import type { Session } from '../../../core/session';
import type { OfflineQueue } from '../../../data/offlineQueue';
import { OfflineIndicator } from '../../../data/OfflineIndicator';
import type { PendingCreate } from '../../../data/offlineQueue';
import { ownerKeyOf, TableHasLocalOrderError } from '../../../data/types';
import { isOnline, useOnline } from '../../../data/useOnline';
import type { OrderRef, WaiterApi } from '../../../data/waiterApi';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { FloorPlan } from './FloorPlan';
import { OpenTableSheet } from './OpenTableSheet';
import { ReadyBanner, type ReadyNotice } from './ReadyBanner';
import { TableActionsSheet, type SheetAction } from './TableActionsSheet';
import { useTablePicking } from './useTablePicking';
import { initialsOf, normalizeOrders, normalizePlan, ordersByTable, tableState, type ActiveOrder, type Plan, type PlanTable, type TableState } from './tableState';
import './tables.css';
import './sheets.css';

export type TablesApi = Pick<WaiterApi, 'floorPlan' | 'activeOrders' | 'orderDetail' | 'createOrder' | 'transfer' | 'groupTables'>;
/** Where the order screen should land. */
export type OrderIntent = 'view' | 'pay' | 'invoice';

export interface TablesScreenProps {
    session: Session;
    api: TablesApi;
    realtime: Pick<Realtime, 'subscribe'>;
    queue: OfflineQueue | null;
    /** Drops the cached plan and active orders so the next read hits the server. */
    invalidate: () => Promise<void>;
    onOpenOrder: (orderId: OrderRef, intent?: OrderIntent, tableId?: number, tableNumber?: string) => void;
    onSwitchUser: () => void;
    /** "Pedido listo" notices of this session (kept by WaiterHome, so they survive a visit to another order). */
    ready?: ReadyNotice[];
    onDismissReady?: (orderId: number) => void;
}

const LIVE_EVENTS = ['ORDER_UPDATE', 'TABLE_STATUS_CHANGED', 'ORDER_READY', 'KITCHEN_NOTIFICATION'] as const;
const REFETCH_DEBOUNCE_MS = 300;
const CLOCK_TICK_MS = 30_000;
const NO_AREA = -1;

function LockIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
    );
}

const NO_NOTICES: ReadyNotice[] = [];

export function TablesScreen({ session, api, realtime, queue, invalidate, onOpenOrder, onSwitchUser, ready = NO_NOTICES, onDismissReady }: TablesScreenProps) {
    const branchId = session.user.branchId;
    const [plan, setPlan] = useState<Plan | null>(null);
    const [orders, setOrders] = useState<ActiveOrder[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [areaId, setAreaId] = useState<number | null>(null);
    const [mineOnly, setMineOnly] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [sheet, setSheet] = useState<{ kind: 'open'; table: PlanTable } | { kind: 'actions'; table: PlanTable; order: ActiveOrder } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [queued, setQueued] = useState<PendingCreate[]>([]);
    const online = useOnline();
    const openAction = useRef<string | null>(null); // one id per "open table" attempt: a retry reuses its key, a later open never does

    const alive = useRef(true);
    const seq = useRef(0);

    const load = useCallback(
        async (fresh: boolean): Promise<boolean> => {
            if (branchId == null) return false;
            const mine = ++seq.current;
            try {
                if (fresh) await invalidate();
                const [planRes, ordersRes] = await Promise.all([
                    api.floorPlan(branchId, (d) => {
                        if (alive.current && mine === seq.current) setPlan(normalizePlan(d));
                    }),
                    api.activeOrders(branchId),
                ]);
                if (!alive.current || mine !== seq.current) return false;
                setPlan(normalizePlan(planRes.data));
                setOrders(normalizeOrders(ordersRes.data));
                setError(null);
                setNow(Date.now());
                return true;
            } catch (cause) {
                if (alive.current && mine === seq.current) setError(getApiErrorMessage(cause));
                return false;
            }
        },
        [api, branchId, invalidate],
    );

    useEffect(() => {
        alive.current = true;
        // Paint from the cache, then always confirm with the network (the 60 s TTL must not hide changes).
        void load(false).then((ok) => {
            if (ok && alive.current && isOnline()) void load(true);
        });
        return () => {
            alive.current = false;
        };
    }, [load]);

    // Live updates: one refetch per burst of events.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                void load(true);
            }, REFETCH_DEBOUNCE_MS);
        };
        // The "pedido listo" banner is fed by the session's inbox (readyInbox.ts); here a kitchen event only refreshes the plan.
        const unsubs = LIVE_EVENTS.map((type) => realtime.subscribe(type, schedule));
        return () => {
            if (timer) clearTimeout(timer);
            unsubs.forEach((u) => u?.());
        };
    }, [realtime, load]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);

    // Orders this waiter opened offline: the queue is the only place that knows about them until they sync.
    useEffect(() => {
        if (!queue) return undefined;
        let live = true;
        const refresh = () => {
            queue.pendingCreates?.().then(
                (list) => live && setQueued(list),
                () => undefined,
            );
        };
        refresh();
        const off = queue.subscribe(refresh);
        const offSynced = queue.onSynced?.((item) => {
            refresh();
            if (item.operationType === 'CREATE_ORDER') void load(true); // the real order replaces the stand-in
        });
        return () => {
            live = false;
            off();
            offSynced?.();
        };
    }, [queue, load]);

    const merged = useMemo(() => {
        const real = ordersByTable(orders);
        if (queued.length === 0) return real;
        const map = new Map(real);
        for (const c of queued) {
            if (c.tableId == null || map.has(c.tableId)) continue; // the server order, once it exists, wins
            map.set(c.tableId, { id: c.tempId, pendingSync: true, tableId: c.tableId, status: 'OPEN', total: 0, guests: c.guests, createdAt: new Date(c.timestamp).toISOString(), user: { id: session.user.id, name: session.user.name }, items: [] });
        }
        return map;
    }, [orders, queued, session.user.id, session.user.name]);
    const byTable = merged;

    // Tabs: the plan's areas, plus "Sin área" when some table has none.
    const tabs = useMemo(() => {
        if (!plan) return [];
        const list = plan.areas.map((a) => ({ id: a.id, name: a.name, count: plan.tables.filter((t) => t.floorAreaId === a.id).length }));
        const orphans = plan.tables.filter((t) => t.floorAreaId == null).length;
        if (orphans > 0) list.push({ id: NO_AREA, name: 'Sin área', count: orphans });
        return list;
    }, [plan]);

    const currentTab = tabs.find((t) => t.id === areaId) ?? tabs[0];
    const activeCount = useMemo(() => {
        if (!plan) return 0;
        return plan.tables.filter((t) => tableState(t, byTable.get(t.id)) !== 'free').length;
    }, [plan, byTable]);
    const branchName = plan?.tables.find((t) => t.branch?.name)?.branch?.name ?? 'Sucursal';

    const areaNameOf = (table: PlanTable) => plan?.areas.find((x) => x.id === table.floorAreaId)?.name ?? 'Sin área';

    const picking = useTablePicking({
        api,
        online,
        onDone: (message) => {
            setToast(message);
            void load(false);
        },
    });

    const handleTap = (table: PlanTable, order: ActiveOrder | undefined, state: TableState) => {
        if (picking.mode) {
            void picking.choose(table);
            return;
        }
        if (order) onOpenOrder(order.id, undefined, table.id, table.number);
        else if (state === 'free') {
            openAction.current = null; // a fresh open: never the key of an earlier attempt
            setSheet({ kind: 'open', table });
        }
        else void load(true); // the plan says occupied but we hold no order: our data is stale
    };

    const handleLongPress = (table: PlanTable, order: ActiveOrder | undefined) => {
        if (picking.mode || !order || order.pendingSync) return; // a stand-in has no server order to act on yet
        setSheet({ kind: 'actions', table, order });
    };

    const openTable = async (table: PlanTable, guests: number) => {
        openAction.current ??= newIdempotencyKey();
        let id: OrderRef | null | undefined;
        try {
            const created = (await api.createOrder(
                { tableId: table.id, guests, orderType: 'DINE_IN' },
                { owner: ownerKeyOf(session) ?? undefined, actionId: openAction.current, meta: { label: `Abrir mesa ${table.number}` } },
            )) as { id?: number; _offline?: boolean; entityTempId?: string | null };
            // Created offline: it only exists in the queue until it syncs, so the order screen opens on its temp id.
            id = created._offline ? created.entityTempId : created.id;
        } catch (cause) {
            // This device already holds an order for the table (opened offline): go to it, never create a second one.
            if (!(cause instanceof TableHasLocalOrderError)) throw cause;
            id = cause.tempId;
        }
        if (id == null) throw new Error('No se pudo abrir la mesa.');
        openAction.current = null;
        setSheet(null);
        onOpenOrder(id, undefined, table.id, table.number);
    };

    const runAction = (action: SheetAction, table: PlanTable, order: ActiveOrder) => {
        setSheet(null);
        if (action === 'view' || action === 'pay' || action === 'invoice') onOpenOrder(order.id, action, table.id, table.number);
        else picking.begin(action, table, order);
    };

    return (
        <main className="tables">
            <header className="tables-head">
                <div className="tables-user">
                    <span className="avatar-disc small" aria-hidden="true">
                        {initialsOf(session.user.name)}
                    </span>
                    <div className="tables-user-text">
                        <strong>{session.user.name}</strong>
                        <span className="muted">{plan ? `${branchName} · ${activeCount} mesas activas` : 'Cargando…'}</span>
                    </div>
                </div>
                <span className="tables-sep" aria-hidden="true" />
                <div className="tabs" role="tablist" aria-label="Áreas">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            className="tab"
                            aria-label={`${tab.name} ${tab.count}`}
                            aria-selected={currentTab?.id === tab.id}
                            onClick={() => setAreaId(tab.id)}
                        >
                            <span>{tab.name}</span>
                            <span className="tab-count">{tab.count}</span>
                        </button>
                    ))}
                </div>
                <span className="grow" />
                <OfflineIndicator queue={queue} />
                <button type="button" className="chip" aria-pressed={mineOnly} onClick={() => setMineOnly((v) => !v)}>
                    Mis mesas
                </button>
                <button type="button" className="btn icon-btn" aria-label="Cambiar usuario" onClick={onSwitchUser}>
                    <LockIcon />
                </button>
            </header>

            {picking.mode && (
                <div className="pick-bar" role="status">
                    <span>
                        {picking.mode === 'transfer' ? 'Trasladar' : 'Unir'} mesa {picking.source?.table.number}: Elige la mesa destino
                    </span>
                    <button type="button" className="btn" onClick={picking.cancel}>
                        Cancelar
                    </button>
                </div>
            )}
            {picking.error && <p className="error pad">{picking.error}</p>}
            {toast && (
                <div className="toast" role="status">
                    <span>{toast}</span>
                    <button type="button" className="ready-banner-close" aria-label="Cerrar aviso" onClick={() => setToast(null)}>
                        ×
                    </button>
                </div>
            )}

            <ReadyBanner
                notices={ready}
                onOpen={(orderId) => {
                    const o = orders.find((x) => x.id === orderId);
                    const tableId = o?.tableId ?? o?.table?.id ?? undefined;
                    const table = plan?.tables.find((t) => t.id === tableId);
                    onOpenOrder(orderId, undefined, tableId, table?.number ?? ready.find((n) => n.orderId === orderId)?.tableNumber);
                }}
                onDismiss={(orderId) => onDismissReady?.(orderId)}
            />

            {branchId == null && <p className="error pad">Tu usuario no tiene sucursal asignada.</p>}
            {error && (
                <div className="pad">
                    <p className="error">{error}</p>
                    <button type="button" className="btn" onClick={() => void load(false)}>
                        Reintentar
                    </button>
                </div>
            )}

            <div className="plan-wrap">
                {plan && currentTab && (
                    <FloorPlan
                        plan={plan}
                        areaId={currentTab.id === NO_AREA ? null : currentTab.id}
                        orders={byTable}
                        now={now}
                        onlyUserId={mineOnly && !picking.mode ? session.user.id : null}
                        onTap={handleTap}
                        canPick={picking.mode ? picking.canPick : undefined}
                        onLongPress={handleLongPress}
                    />
                )}
                {plan && !currentTab && !error && <p className="muted pad">No hay mesas configuradas.</p>}
            </div>

            {sheet?.kind === 'open' && (
                <OpenTableSheet
                    table={sheet.table}
                    areaName={areaNameOf(sheet.table)}
                    canOpen={can(session.user, 'orders.create')}
                    onClose={() => {
                        openAction.current = null;
                        setSheet(null);
                    }}
                    onOpen={(guests) => openTable(sheet.table, guests)}
                />
            )}
            {sheet?.kind === 'actions' && (
                <TableActionsSheet
                    table={sheet.table}
                    areaName={areaNameOf(sheet.table)}
                    order={sheet.order}
                    user={session.user}
                    online={online}
                    now={now}
                    loadDetail={api.orderDetail}
                    onClose={() => setSheet(null)}
                    onAction={(action) => runAction(action, sheet.table, sheet.order)}
                />
            )}
        </main>
    );
}
