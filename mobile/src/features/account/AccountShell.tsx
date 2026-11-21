import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { appEvents } from '../../core/events';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { AccountHome } from './AccountHome';
import { ChangePasswordScreen } from './ChangePasswordScreen';
import { LoginScreen } from './LoginScreen';

interface Props {
    /** Null while logged out / expired: the shell stays mounted and shows login above the kept tree. */
    session: Session | null;
    services: Services;
    onSession: (session: Session) => void;
    onSessionEnd: () => void;
    /** Screen content; defaults to the account home. Receives the last known session while logged out. */
    children?: (session: Session) => ReactNode;
}

const NOTICES = {
    expired: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    changed: 'Contraseña cambiada. Inicia sesión de nuevo.',
} as const;

const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', background: 'var(--bg)' };

/**
 * Always-mounted account shell. The screen tree survives an expiry and a re-login by the
 * same user (drafts intact); a different user, or an explicit logout, remounts it.
 */
export function AccountShell({ session, services, onSession, onSessionEnd, children }: Props) {
    const { accountApi } = services;
    const [track, setTrack] = useState<{ userId: number | null; companyId: number | null; key: number; last: Session | null }>({
        userId: session?.user.id ?? null,
        companyId: session?.user.companyId ?? null,
        key: 0,
        last: session,
    });
    const [forced, setForced] = useState(false);
    const [notice, setNotice] = useState<keyof typeof NOTICES | null>(null);

    // Derive during render so a different user never paints one frame of the old tree.
    if (session && (track.userId !== session.user.id || track.companyId !== (session.user.companyId ?? null) || track.last !== session)) {
        const sameUser = track.userId === null || (track.userId === session.user.id && track.companyId === (session.user.companyId ?? null));
        setTrack({ userId: session.user.id, companyId: session.user.companyId ?? null, key: sameUser ? track.key : track.key + 1, last: session });
    }
    const treeSession = session ?? track.last;

    // The tree was wiped (different user or explicit logout): per-user caches (Task 3 hrApi) must drop.
    const seenKey = useRef(track.key);
    useEffect(() => {
        if (seenKey.current === track.key) return;
        seenKey.current = track.key;
        appEvents.emit('account-user-changed');
    }, [track.key]);

    useEffect(() => appEvents.on('session-expired', () => setNotice('expired')), []);
    useEffect(() => appEvents.on('password-change-required', () => setForced(true)), []);

    const handleLoggedIn = useCallback(
        (next: Session) => {
            setNotice(null);
            setForced(false);
            onSession(next);
        },
        [onSession],
    );

    const handleLogout = useCallback(() => {
        void accountApi.logout().catch(() => undefined);
        setNotice(null);
        setForced(false);
        setTrack((t) => ({ userId: null, companyId: null, key: t.key + 1, last: null }));
        onSessionEnd();
    }, [accountApi, onSessionEnd]);

    const handleChanged = useCallback(() => {
        // The server revoked every session and the api dropped the local one.
        setForced(false);
        setNotice('changed');
        onSessionEnd();
    }, [onSessionEnd]);

    const blocked = !!session && (session.mustChangePassword === true || session.passwordExpired === true || forced);
    const overlay = !session ? 'login' : blocked ? 'password' : null;

    return (
        <>
            {treeSession && (
                <div
                    key={track.key}
                    data-testid="account-tree"
                    aria-hidden={overlay ? true : undefined}
                    ref={(el) => {
                        if (!el) return;
                        if (overlay) el.setAttribute('inert', '');
                        else el.removeAttribute('inert');
                    }}
                >
                    {children ? children(treeSession) : <AccountHome session={treeSession} onLogout={handleLogout} />}
                </div>
            )}
            {overlay === 'login' && (
                <div style={overlayStyle}>
                    <LoginScreen api={accountApi} onLoggedIn={handleLoggedIn} notice={notice ? NOTICES[notice] : null} />
                </div>
            )}
            {overlay === 'password' && (
                <div style={overlayStyle}>
                    <ChangePasswordScreen api={accountApi} onChanged={handleChanged} onLogout={handleLogout} />
                </div>
            )}
        </>
    );
}
