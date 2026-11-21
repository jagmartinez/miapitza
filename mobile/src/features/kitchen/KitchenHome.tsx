import { useEffect, useMemo, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import { kitchenAuthStatus, type KitchenAuthStatus } from '../../core/kitchenAuth';
import { realtimeStatus } from '../../core/realtime';
import { can } from '../../core/permissions';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { KitchenBoard, type KitchenConnection } from './KitchenBoard';
import { createKitchenApi } from './kitchenApi';

function connectionOf(auth: KitchenAuthStatus, realtimeOnline: boolean, hasSession: boolean): KitchenConnection {
    if (auth === 'account-unavailable') return 'unavailable';
    if (auth === 'offline') return 'offline';
    if (auth === 'renewing' || auth === 'connecting' || !hasSession || !realtimeOnline) return 'reconnecting';
    return 'online';
}

/**
 * Always mounted in kitchen mode: a renewed session (`session` briefly null) must not reset the board.
 * Keeps the last non-null session so permission checks keep working while reconnecting.
 */
export function KitchenHome(props: { session: Session | null; services: Services }) {
    const { session, services } = props;
    const lastSession = useRef<Session | null>(session);
    if (session) lastSession.current = session;
    const [auth, setAuth] = useState<KitchenAuthStatus>(kitchenAuthStatus());
    const [realtimeOnline, setRealtimeOnline] = useState(() => realtimeStatus() === 'online');
    useEffect(() => {
        setAuth(kitchenAuthStatus());
        const offAuth = appEvents.on('kitchen-auth-status', (s) => setAuth(s as KitchenAuthStatus));
        const offRt = appEvents.on('realtime-status', (s) => setRealtimeOnline(s !== 'offline'));
        return () => {
            offAuth();
            offRt();
        };
    }, []);

    // Guarded http instance: a 401 triggers the kitchen re-login. Created once so hooks stay stable.
    const api = useMemo(() => createKitchenApi(services.http), [services.http]);
    const user = lastSession.current?.user;
    return (
        <main data-testid="kitchen-home" data-has-session={session ? 'true' : 'false'}>
            <KitchenBoard
                api={api}
                realtime={services.realtime}
                canManage={!!user && can(user, 'kds.manage')}
                connection={connectionOf(auth, realtimeOnline, session !== null)}
            />
        </main>
    );
}
