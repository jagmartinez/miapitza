import { useEffect, useMemo, useState } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { loadWaiterData } from '../../data/loadWaiterData';
import type { WaiterData } from '../../data/waiterData';
import { InventoryHome } from './InventoryHome';
import { CountScreen } from './CountScreen';
import { DropNotices } from './DropNotices';
import { FinishCountScreen } from './FinishCountScreen';
import { NewCountScreen } from './NewCountScreen';
import { createInventoryApi } from './inventoryApi';
import { useDroppedLines } from './useDroppedLines';

/** Internal routes of the blind count. The screens of each one arrive with their own task; the entry owns which one is up. */
export type InventoryRoute = { name: 'home' } | { name: 'new' } | { name: 'count'; sheetId: number; uncountedOnly?: boolean } | { name: 'finish'; sheetId: number };

/**
 * Lazy entry of Inventario: loads the waiter data layer (queue included, so queued line saves replay while this screen is up),
 * then shows the count screens. `onBack` exists only when it was opened from the tables.
 */
export default function InventoryEntry({ session, services, onSwitchUser, onBack, branchName }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; onSwitchUser: () => void; onBack?: () => void; branchName?: string | null }) {
    const [data, setData] = useState<WaiterData | null>(null);
    const [failed, setFailed] = useState(false);
    const [route, setRoute] = useState<InventoryRoute>({ name: 'home' });

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

    // Replay queued count saves while the screen is up; a new user (PIN switch) replays their own queue.
    const userId = session.user.id;
    useEffect(() => {
        if (!data) return undefined;
        return data.queue.start();
    }, [data]);
    useEffect(() => {
        if (data) data.queue.notifySessionChanged();
    }, [data, userId]);

    const api = useMemo(() => (data ? createInventoryApi(data, services.http) : null), [data, services.http]);

    // Lines the queue dropped for good are told on whichever screen is up: inside the count and finish screens, as a toast elsewhere.
    const { drops, tick, dismiss } = useDroppedLines(api);
    const toast = drops.length > 0 && (
        <div className="cnt-toast">
            <DropNotices drops={drops} onDismiss={dismiss} />
        </div>
    );

    if (data && api && route.name === 'home')
        return (
            <>
                <InventoryHome api={api} user={session.user} onNew={() => setRoute({ name: 'new' })} onContinue={(sheetId) => setRoute({ name: 'count', sheetId })} onSwitchUser={onSwitchUser} onBack={onBack} branchName={branchName} />
                {toast}
            </>
        );
    if (data && api && route.name === 'new')
        return (
            <>
                <NewCountScreen api={api} onStarted={(sheetId) => setRoute({ name: 'count', sheetId })} onBack={() => setRoute({ name: 'home' })} />
                {toast}
            </>
        );

    if (data && api && route.name === 'count')
        return (
            <CountScreen
                key={`${route.sheetId}-${route.uncountedOnly ? 'u' : 'a'}`}
                api={api}
                sheetId={route.sheetId}
                user={session.user}
                uncountedOnly={route.uncountedOnly}
                drops={drops}
                onDismissDrop={dismiss}
                dropTick={tick}
                onFinish={() => setRoute({ name: 'finish', sheetId: route.sheetId })}
                onExit={() => setRoute({ name: 'home' })}
            />
        );
    if (data && api && route.name === 'finish')
        return (
            <FinishCountScreen
                api={api}
                sheetId={route.sheetId}
                drops={drops}
                onDismissDrop={dismiss}
                dropTick={tick}
                onBack={() => setRoute({ name: 'count', sheetId: route.sheetId })}
                onRecount={() => setRoute({ name: 'count', sheetId: route.sheetId, uncountedOnly: true })}
                onSubmitted={() => setRoute({ name: 'home' })}
            />
        );

    // Loading.
    return (
        <main className="screen inventory" data-testid="inventory-entry" data-route={route.name}>
            <header className="inventory-bar">
                {onBack && (
                    <button type="button" className="btn" aria-label="Volver" onClick={route.name === 'home' ? onBack : () => setRoute({ name: 'home' })}>
                        ←
                    </button>
                )}
                <strong>Inventario</strong>
                <span className="grow" />
                <button type="button" className="btn" aria-label="Cambiar usuario" onClick={onSwitchUser}>
                    Cambiar usuario
                </button>
            </header>
            {!data && <p className={failed ? 'error' : 'muted'}>{failed ? 'No se pudo preparar el inventario.' : 'Cargando…'}</p>}
        </main>
    );
}
