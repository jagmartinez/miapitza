import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { loadWaiterData } from '../../data/loadWaiterData';
import type { WaiterData } from '../../data/waiterData';
import type { OrderRef } from '../../data/waiterApi';
import { ownerKeyOf } from '../../data/types';
import { loadCashApi } from '../../data/loadCashApi';


import { SurveyBoundary } from '../survey/SurveyBoundary';
import { useBackBlock } from '../survey/useBackBlock';
import { createSurveyApi } from '../survey/surveyApi';
import { TablesScreen, type OrderIntent } from './tables/TablesScreen';
import { useReadyInbox } from './readyInbox';

type Route = { name: 'tables' } | { name: 'cash' } | { name: 'cashCount'; shiftId: number; mode: 'partial' | 'close' } | { name: 'cashReport'; shiftId: number } | { name: 'survey'; orderId: number; waiterName: string } | { name: 'order'; orderId: OrderRef; intent?: OrderIntent; tableId?: number; tableNumber?: string };

// The order screen is the biggest waiter chunk: it loads when the first order opens.
const OrderScreen = lazy(() => import('./order/OrderScreen').then((m) => ({ default: m.OrderScreen })));

// Caja loads (with its data layer) only when a cashier opens it; "Cerrar turno" / "Arqueo parcial" land on cashCount (Task 6).
const CashEntry = lazy(() => import('../cash/CashEntry'));
const CountCloseEntry = lazy(() => import('../cash/CountCloseEntry'));
const CloseReportEntry = lazy(() => import('../cash/CloseReportEntry'));
const SurveyScreen = lazy(() => import('../survey/SurveyScreen'));
const loadingFallback = <main className="screen"><p className="muted">Cargando…</p></main>;

const STALE_URLS = ['/orders/active', '/tables/plan'];

export function WaiterHome({ session, services, onSwitchUser }: { session: Session; services: Pick<Services, 'http' | 'sessions' | 'realtime'>; onSwitchUser: () => void }) {
    const [data, setData] = useState<WaiterData | null>(null);
    const [failed, setFailed] = useState(false);
    const [route, setRoute] = useState<Route>({ name: 'tables' });
    // A close that was sent but whose outcome the cashier may not have seen: Caja checks it when she comes back.
    const [closeAttempt, setCloseAttempt] = useState<number | null>(null);
    const inbox = useReadyInbox(services.realtime);
    // Opening an order is seeing it: its "listo" notice is done.
    const openedId = route.name === 'order' ? Number(route.orderId) : null;
    const { dismiss } = inbox;
    useEffect(() => {
        if (openedId != null && Number.isFinite(openedId)) dismiss(openedId);
    }, [openedId, dismiss]);

    // The data layer (Dexie) loads on first use of waiter mode, never in the PIN/kitchen bundle.
    useEffect(() => {
        let alive = true;
        loadWaiterData(services).then(
            (d) => alive && setData(d),
            () => alive && setFailed(true),
        );
        return () => {
            alive = false;
        };
    }, [services]);

    // Replay offline work while this waiter's screen is up; a new user (PIN switch) replays their own queue.
    const userId = session.user.id;
    useEffect(() => {
        if (!data) return undefined;
        const stop = data.queue.start();
        return stop;
    }, [data]);
    useEffect(() => {
        if (data) data.queue.notifySessionChanged();
    }, [data, userId]);

    const loadCash = useCallback(() => loadCashApi(services), [services]);
    const owner = ownerKeyOf(session);
    const invalidate = useCallback(async () => {
        if (data && owner) await data.cache.invalidate(owner, STALE_URLS);
    }, [data, owner]);

    // Back is swallowed from the moment the survey route is chosen, also while its chunk loads.
    useBackBlock(route.name === 'survey');
    const surveySubmit = useMemo(() => (data ? createSurveyApi(data.api).submit : async () => undefined), [data]);

    if (!data) {
        return (
            <main className="screen">
                <p className={failed ? 'error' : 'muted'}>{failed ? 'No se pudo preparar el modo mesero.' : 'Cargando…'}</p>
                <button type="button" className="btn" aria-label="Cambiar usuario" onClick={onSwitchUser}>
                    Cambiar usuario
                </button>
            </main>
        );
    }

    if (route.name === 'cash') {
        return (
            <Suspense fallback={loadingFallback}>
                <CashEntry session={session} services={services} onBack={() => setRoute({ name: 'tables' })} onCount={(shiftId, mode) => setRoute({ name: 'cashCount', shiftId, mode })} closeAttempt={closeAttempt} onAttemptSeen={() => setCloseAttempt(null)} />
            </Suspense>
        );
    }
    if (route.name === 'cashCount') {
        return (
            <Suspense fallback={loadingFallback}>
                <CountCloseEntry key={owner ?? ''} session={session} services={services} shiftId={route.shiftId} mode={route.mode} onBack={() => setRoute({ name: 'cash' })} onCloseAttempt={setCloseAttempt} onClosed={(shiftId) => { setCloseAttempt(null); setRoute({ name: 'cashReport', shiftId }); }} />
            </Suspense>
        );
    }

    if (route.name === 'cashReport') {
        return (
            <Suspense fallback={loadingFallback}>
                <CloseReportEntry key={owner ?? ''} session={session} services={services} shiftId={route.shiftId} onDone={() => setRoute({ name: 'tables' })} />
            </Suspense>
        );
    }

    if (route.name === 'survey') {
        // Locked: no way back to the order. It ends on its own (thanks or idle) through onSwitchUser, which locks and revokes the session.
        return (
            <Suspense fallback={loadingFallback}>
                <SurveyBoundary onFail={onSwitchUser}>
                    <SurveyScreen orderId={route.orderId} waiterName={route.waiterName} submit={surveySubmit} onDone={onSwitchUser} />
                </SurveyBoundary>
            </Suspense>
        );
    }

    if (route.name === 'order') {
        return (
            <Suspense fallback={<main className="screen"><p className="muted">Cargando…</p></main>}>
                <OrderScreen
                    key={String(route.orderId)}
                    session={session}
                    api={data.api}
                    drafts={data.drafts}
                    plans={data.plans}
                    realtime={services.realtime}
                    queue={data.queue}
                    orderId={route.orderId}
                    tableId={route.tableId}
                    tableNumber={route.tableNumber}
                    intent={route.intent}
                    readyCount={inbox.notices.filter((n) => n.orderId !== openedId).length}
                    invalidate={invalidate}
                    loadCash={loadCash}
                    onOpenCash={() => setRoute({ name: 'cash' })}
                    onSurvey={({ orderId, waiterName }) => setRoute({ name: 'survey', orderId, waiterName })}
                    onBack={() => setRoute({ name: 'tables' })}
                />
            </Suspense>
        );
    }

    return (
        <TablesScreen
            session={session}
            api={data.api}
            realtime={services.realtime}
            queue={data.queue}
            invalidate={invalidate}
            ready={inbox.notices}
            onDismissReady={inbox.dismiss}
            onOpenOrder={(orderId, intent, tableId, tableNumber) => setRoute({ name: 'order', orderId, intent, tableId, tableNumber })}
            onSwitchUser={onSwitchUser}
            onOpenCash={() => setRoute({ name: 'cash' })}
        />
    );
}
