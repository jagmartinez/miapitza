import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { loadWaiterData } from '../../data/loadWaiterData';
import type { WaiterData } from '../../data/waiterData';
import type { OrderRef } from '../../data/waiterApi';
import { ownerKeyOf } from '../../data/types';


import { TablesScreen, type OrderIntent } from './tables/TablesScreen';

type Route = { name: 'tables' } | { name: 'order'; orderId: OrderRef; intent?: OrderIntent; tableId?: number };

// The order screen is the biggest waiter chunk: it loads when the first order opens.
const OrderScreen = lazy(() => import('./order/OrderScreen').then((m) => ({ default: m.OrderScreen })));

const STALE_URLS = ['/orders/active', '/tables/plan'];

export function WaiterHome({ session, services, onSwitchUser }: { session: Session; services: Pick<Services, 'http' | 'sessions' | 'realtime'>; onSwitchUser: () => void }) {
    const [data, setData] = useState<WaiterData | null>(null);
    const [failed, setFailed] = useState(false);
    const [route, setRoute] = useState<Route>({ name: 'tables' });

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

    const owner = ownerKeyOf(session);
    const invalidate = useCallback(async () => {
        if (data && owner) await data.cache.invalidate(owner, STALE_URLS);
    }, [data, owner]);

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

    if (route.name === 'order') {
        return (
            <Suspense fallback={<main className="screen"><p className="muted">Cargando…</p></main>}>
                <OrderScreen
                    key={String(route.orderId)}
                    session={session}
                    api={data.api}
                    drafts={data.drafts}
                    realtime={services.realtime}
                    queue={data.queue}
                    orderId={route.orderId}
                    tableId={route.tableId}
                    intent={route.intent}
                    invalidate={invalidate}
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
            onOpenOrder={(orderId, intent, tableId) => setRoute({ name: 'order', orderId, intent, tableId })}
            onSwitchUser={onSwitchUser}
        />
    );
}
