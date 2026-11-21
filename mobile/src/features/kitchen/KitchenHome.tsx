import { useEffect, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import { kitchenAuthStatus, type KitchenAuthStatus } from '../../core/kitchenAuth';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';

const STATUS_TEXT: Record<KitchenAuthStatus, string | null> = {
    connecting: 'Conectando…',
    online: null,
    renewing: 'Reconectando…',
    offline: 'Reconectando…',
    'account-unavailable': 'Cuenta de cocina no disponible — avisa al administrador',
};

/**
 * Always mounted in kitchen mode: a renewed session (`session` briefly null) must not reset the board.
 * Keeps the last non-null session so permission checks keep working while reconnecting.
 */
export function KitchenHome(props: { session: Session | null; services: Services }) {
    const { session } = props; // services: used by the board in Task 6
    const lastSession = useRef<Session | null>(session);
    if (session) lastSession.current = session;
    const [status, setStatus] = useState<KitchenAuthStatus>(kitchenAuthStatus());
    useEffect(() => {
        setStatus(kitchenAuthStatus());
        return appEvents.on('kitchen-auth-status', (s) => setStatus(s as KitchenAuthStatus));
    }, []);

    const shown = session === null && (status === 'online' || status === 'connecting') ? 'Reconectando…' : STATUS_TEXT[status];
    const user = lastSession.current?.user;
    return (
        <main data-testid="kitchen-home" data-has-session={session ? 'true' : 'false'}>
            <header className="top-bar">
                <span>Cocina</span>
                <span className="muted">{user?.name ?? ''}</span>
            </header>
            {shown && (
                <p className="muted" role="status" style={{ padding: 16 }}>
                    {shown}
                </p>
            )}
            <p className="muted" style={{ padding: 16 }}>Pantalla de cocina (próximamente)</p>
        </main>
    );
}
