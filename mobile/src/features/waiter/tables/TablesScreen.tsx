import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { can } from '../../../core/permissions';
import type { Realtime } from '../../../core/realtime';
import type { Session } from '../../../core/session';
import type { OfflineQueue } from '../../../data/offlineQueue';
import { OfflineIndicator } from '../../../data/OfflineIndicator';
import { isOnline, useOnline } from '../../../data/useOnline';
import type { OrderRef, WaiterApi } from '../../../data/waiterApi';
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
    onOpenOrder: (orderId: OrderRef, intent?: OrderIntent, tableId?: number) => void;
    onSwitchUser: () => void;
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

export function TablesScreen({ session, api, realtime, queue, invalidate, onOpenOrder, onSwitchUser }: TablesScreenProps) {
    const branchId = session.user.branchId;
    const [plan, setPlan] = useState<Plan | null>(null);
    const [orders, setOrders] = useState<ActiveOrder[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [areaId, setAreaId] = useState<number | null>(null);
    const [mineOnly, setMineOnly] = useState(false);
    const [notice, setNotice] = useState<ReadyNotice | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [sheet, setSheet] = useState<{ kind: 'open'; table: PlanTable } | { kind: 'actions'; table: PlanTable; order: ActiveOrder } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const online = useOnline();

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
        // KITCHEN_NOTIFICATION only reaches the waiter who created the order. The banner is for a fully ready order (ORDER_READY),
        // not for single ready items (ORDER_ITEM_READY) nor releases (ORDER_RELEASED).
        const onKitchen = (payload: unknown) => {
            schedule();
            const p = (payload ?? {}) as { orderId?: unknown; tableNumber?: unknown; eventType?: unknown };
            if (typeof p.orderId !== 'number' || p.eventType !== 'ORDER_READY') return;
            setNotice({ orderId: p.orderId, tableNumber: p.tableNumber == null ? undefined : String(p.tableNumber) });
            try {
                navigator.vibrate?.([200, 100, 200]);
            } catch {
                // no vibrator: the banner is enough
            }
        };
        const unsubs = LIVE_EVENTS.map((type) => realtime.subscribe(type, type === 'KITCHEN_NOTIFICATION' ? onKitchen : schedule));
        return () => {
            if (timer) clearTimeout(timer);
            unsubs.forEach((u) => u?.());
        };
    }, [realtime, load]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);

    const byTable = useMemo(() => ordersByTable(orders), [orders]);

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
        if (order) onOpenOrder(order.id, undefined, table.id);
        else if (state === 'free') setSheet({ kind: 'open', table });
        else void load(true); // the plan says occupied but we hold no order: our data is stale
    };

    const handleLongPress = (table: PlanTable, order: ActiveOrder | undefined) => {
        if (picking.mode || !order) return;
        setSheet({ kind: 'actions', table, order });
    };

    const openTable = async (table: PlanTable, guests: number) => {
        const created = (await api.createOrder({ tableId: table.id, guests, orderType: 'DINE_IN' })) as { id?: number; _offline?: boolean; entityTempId?: string | null };
        // Created offline: it only exists in the queue until it syncs, so the order screen opens on its temp id.
        const id = created._offline ? created.entityTempId : created.id;
        if (id == null) throw new Error('No se pudo abrir la mesa.');
        setSheet(null);
        onOpenOrder(id, undefined, table.id);
    };

    const runAction = (action: SheetAction, table: PlanTable, order: ActiveOrder) => {
        setSheet(null);
        if (action === 'view' || action === 'pay' || action === 'invoice') onOpenOrder(order.id, action, table.id);
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

            <ReadyBanner notice={notice} onOpen={(orderId) => {
                const o = orders.find((x) => x.id === orderId);
                onOpenOrder(orderId, undefined, o?.tableId ?? o?.table?.id ?? undefined);
            }} onDismiss={() => setNotice(null)} />

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
                    onClose={() => setSheet(null)}
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
