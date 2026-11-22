import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { appEvents } from '../core/events';
import { createKitchenAuth } from '../core/kitchenAuth';
import { resolveMode } from '../core/mode';
import { applyOrientation } from '../core/orientation';
import type { Services } from '../core/services';
import type { DeviceType, Session } from '../core/session';
import { IdleLockBoundary } from '../core/IdleLockBoundary';
import { can } from '../core/permissions';
import { AccountShell } from '../features/account/AccountShell';
import { DeviceSetupScreen } from '../features/device/DeviceSetupScreen';
import { PinScreen } from '../features/pin/PinScreen';
import { WaiterHome } from '../features/waiter/WaiterHome';
import { loadWaiterData, wipeWaiterData } from '../data/loadWaiterData';

// Split out of the main bundle: waiter and account tablets never need the kitchen board.
// Inventory-only roles (BODEGA, CHEF) have no floor plan: they land on Inventario and never load the tables.
const InventoryEntry = lazy(() => import('../features/inventory/InventoryEntry'));
const KitchenHome = lazy(() => import('../features/kitchen/KitchenHome').then((m) => ({ default: m.KitchenHome })));

/** Locks the waiter tablet back to the PIN screen after 2 minutes without touch (10 while a cash count has entries). */
function WaiterSession({ session, services, onSwitchUser, branchName }: { session: Session; services: Services; onSwitchUser: () => void; branchName: string | null }) {
    if (!can(session.user, 'tables.map.view') && can(session.user, 'inventory.count')) {
        return (
            <IdleLockBoundary onLock={onSwitchUser}>
                <Suspense fallback={<main className="screen"><p className="muted">Cargando…</p></main>}>
                    <InventoryEntry session={session} services={services} onSwitchUser={onSwitchUser} branchName={branchName} />
                </Suspense>
            </IdleLockBoundary>
        );
    }
    return (
        <IdleLockBoundary onLock={onSwitchUser}>
            <WaiterHome session={session} services={services} onSwitchUser={onSwitchUser} branchName={branchName} />
        </IdleLockBoundary>
    );
}

export function Router({ services }: { services: Services }) {
    const { sessions, realtime, pinApi, deviceApi } = services;
    // undefined while the secure store is still being read.
    const [deviceType, setDeviceType] = useState<DeviceType | null | undefined>(undefined);
    const [session, setSession] = useState<Session | null>(null);
    const [branchName, setBranchName] = useState<string | null>(null);
    const mode = deviceType === undefined ? null : resolveMode(deviceType);
    // Queued offline work per user, so the PIN screen can call its author back (ruling a). Loads the data layer lazily.
    const loadPending = useCallback(async () => (await loadWaiterData(services)).queue.pendingByUser(), [services]);

    useEffect(() => {
        let alive = true;
        void (async () => {
            // Unreadable storage must land on setup, never on a blank screen.
            let type: DeviceType | null = null;
            let stored: Session | null = null;
            try {
                type = await sessions.deviceType();
                stored = await sessions.load();
            } catch {
                type = null;
                stored = null;
            }
            if (type === 'SERVICE_TABLET' || type === 'KITCHEN_TABLET') {
                // Shared devices always start from the PIN screen / a fresh device login.
                // Best effort: revoke the abandoned session server-side too.
                if (stored) {
                    void services.http
                        .post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${stored.token}` } })
                        .catch(() => undefined);
                }
                try {
                    await sessions.clear();
                } catch {
                    // The in-memory session is gone; the PIN screen is shown regardless.
                }
                stored = null;
            }
            if (!alive) return;
            setSession(stored);
            setDeviceType(type);
            if (type === 'PERSONAL' && stored) realtime.connect();
        })();
        return () => {
            alive = false;
        };
    }, [sessions, realtime, services.http]);

    // Branch name saved by the roster / kitchen login; absent with an older server.
    useEffect(() => {
        if (!session) return;
        let alive = true;
        sessions.branchName().then((name) => alive && setBranchName(name), () => undefined);
        return () => {
            alive = false;
        };
    }, [session, sessions]);

    useEffect(() => {
        if (mode) void applyOrientation(mode);
    }, [mode]);

    // The http layer already cleared the stored session; mirror that in the UI.
    useEffect(
        () =>
            appEvents.on('session-expired', () => {
                realtime.close();
                setSession(null);
            }),
        [realtime],
    );

    const revoke = useCallback(async () => {
        realtime.close();
        try {
            await sessions.clear();
            await sessions.clearDevice();
        } catch {
            // Unpairing must reach setup even if storage throws.
        }
        try {
            await wipeWaiterData(services);
        } catch {
            // Best effort: the local database is also unreachable without a paired device.
        }
        setSession(null);
        setDeviceType(null);
    }, [realtime, sessions, services]);
    const handleRevoked = useCallback(() => void revoke(), [revoke]);

    useEffect(() => {
        if (mode !== 'kitchen') return;
        const kitchen = createKitchenAuth({
            http: services.http,
            sessions,
            realtime,
            onRevoked: handleRevoked,
            onSession: setSession,
        });
        void kitchen.start();
        return () => kitchen.stop();
    }, [mode, services.http, sessions, realtime, handleRevoked]);

    const switchUser = useCallback(() => {
        // Lock now; logout closes realtime, drops the session and revokes in the background.
        void pinApi.logout().catch(() => undefined);
        setSession(null);
    }, [pinApi]);

    if (mode === null) return null;

    switch (mode) {
        case 'setup':
            return <DeviceSetupScreen api={deviceApi} onDone={setDeviceType} />;
        case 'waiter':
            return session ? (
                <WaiterSession session={session} services={services} onSwitchUser={switchUser} branchName={branchName} />
            ) : (
                <PinScreen api={pinApi} onLoggedIn={setSession} onRevoked={handleRevoked} loadPending={loadPending} />
            );
        case 'kitchen':
            // Mounted regardless of the session: a renewal must not unmount the board.
            return (
                <Suspense fallback={<main className="screen"><p className="muted">Conectando…</p></main>}>
                    <KitchenHome session={session} services={services} branchName={branchName} />
                </Suspense>
            );
        case 'account':
            // Mounted regardless of the session: an expiry shows login over the kept screens.
            return <AccountShell session={session} services={services} onSession={setSession} onSessionEnd={() => setSession(null)} />;
    }
}
