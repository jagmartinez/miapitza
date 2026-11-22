import { useEffect, useState } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { loadWaiterData } from '../../data/loadWaiterData';
import type { WaiterData } from '../../data/waiterData';

/** Internal routes of the blind count. The screens of each one arrive with their own task; the entry owns which one is up. */
export type InventoryRoute = { name: 'home' } | { name: 'new' } | { name: 'count'; sheetId: number } | { name: 'finish'; sheetId: number };

/**
 * Lazy entry of Inventario: loads the waiter data layer (queue included, so queued line saves replay while this screen is up),
 * then shows the count screens. `onBack` exists only when it was opened from the tables.
 */
export default function InventoryEntry({ session, services, onSwitchUser, onBack }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; onSwitchUser: () => void; onBack?: () => void }) {
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
