import { useCallback, useEffect, useState } from 'react';
import { appEvents } from '../core/events';
import { createKitchenAuth } from '../core/kitchenAuth';
import { resolveMode } from '../core/mode';
import { applyOrientation } from '../core/orientation';
import type { Services } from '../core/services';
import type { DeviceType, Session } from '../core/session';
import { useIdleLock } from '../core/useIdleLock';
import { AccountHome } from '../features/account/AccountHome';
import { LoginScreen } from '../features/account/LoginScreen';
import { DeviceSetupScreen } from '../features/device/DeviceSetupScreen';
import { KitchenHome } from '../features/kitchen/KitchenHome';
import { PinScreen } from '../features/pin/PinScreen';
import { WaiterHome } from '../features/waiter/WaiterHome';

/** Locks the waiter tablet back to the PIN screen after 2 minutes without touch. */
function WaiterSession({ session, services, onSwitchUser }: { session: Session; services: Services; onSwitchUser: () => void }) {
    useIdleLock(onSwitchUser);
    return <WaiterHome session={session} services={services} onSwitchUser={onSwitchUser} />;
}

export function Router({ services }: { services: Services }) {
    const { sessions, realtime, pinApi, deviceApi, accountApi } = services;
    // undefined while the secure store is still being read.
    const [deviceType, setDeviceType] = useState<DeviceType | null | undefined>(undefined);
    const [session, setSession] = useState<Session | null>(null);
    const mode = deviceType === undefined ? null : resolveMode(deviceType);

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
        setSession(null);
        setDeviceType(null);
    }, [realtime, sessions]);
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
                <WaiterSession session={session} services={services} onSwitchUser={switchUser} />
            ) : (
                <PinScreen api={pinApi} onLoggedIn={setSession} onRevoked={handleRevoked} />
            );
        case 'kitchen':
            return session ? <KitchenHome session={session} /> : <main className="screen"><p className="muted">Conectando…</p></main>;
        case 'account':
            return session ? (
                <AccountHome
                    session={session}
                    onLogout={() => {
                        void accountApi.logout().catch(() => undefined);
                        setSession(null);
                    }}
                />
            ) : (
                <LoginScreen api={accountApi} onLoggedIn={setSession} />
            );
    }
}
