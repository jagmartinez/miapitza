import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../../core/session';
import { httpStatus } from '../../core/httpErrors';
import { IconBackspace } from '../../ui/Icon';
import type { PinApi, RosterUser } from './pinApi';
import './pin.css';

const MIN_DIGITS = 4;
const MAX_DIGITS = 6;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface Props {
    api: PinApi;
    onLoggedIn: (session: Session) => void;
    /** The server rejected the device token itself: the device was revoked. */
    onRevoked: () => void;
    /** Queued offline work of every user on this tablet, by user id: shown under each avatar so its author logs in and reviews it. */
    /** Branch shown as the roster title; without it the title is the prompt itself. */
    branchName?: string;
    loadPending?: () => Promise<Record<number, { pending: number; failed: number }>>;
}

const pendingText = ({ pending, failed }: { pending: number; failed: number }): string | null => {
    const waiting = pending > 0 ? `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}` : null;
    const broken = failed > 0 ? `${failed} con error` : null;
    return [waiting, broken].filter(Boolean).join(' · ') || null;
};

export function PinScreen({ api, onLoggedIn, onRevoked, loadPending, branchName }: Props) {
    const [pendingBy, setPendingBy] = useState<Record<number, { pending: number; failed: number }>>({});
    const [roster, setRoster] = useState<RosterUser[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [selected, setSelected] = useState<RosterUser | null>(null);
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);

    const loadRoster = useCallback(() => {
        let alive = true;
        setLoadFailed(false);
        api.roster().then(
            (users) => alive && setRoster(users),
            (err) => {
                if (!alive) return;
                if (httpStatus(err) === 401) onRevoked();
                else setLoadFailed(true);
            },
        );
        return () => {
            alive = false;
        };
    }, [api, onRevoked]);

    useEffect(() => loadRoster(), [loadRoster]);

    useEffect(() => {
        if (!loadPending) return undefined;
        let alive = true;
        // Informational only: a failing lookup never blocks signing in.
        loadPending().then(
            (by) => alive && setPendingBy(by),
            () => undefined,
        );
        return () => {
            alive = false;
        };
    }, [loadPending]);

    function press(digit: string) {
        if (busy) return;
        setError(false);
        setPin((current) => (current.length < MAX_DIGITS ? current + digit : current));
    }

    async function submit() {
        // Always an explicit "Entrar": the roster does not reveal the PIN length.
        if (!selected || pin.length < MIN_DIGITS || busy) return;
        setBusy(true);
        try {
            const session = await api.login(selected.id, pin);
            setPin('');
            onLoggedIn(session);
        } catch {
            // One generic message for every failure; never say which part was wrong.
            setError(true);
            setPin('');
            setBusy(false);
        }
    }

    return (
        <div className="pin">
            <div className="pin-panel">
                <section className="pin-roster" aria-label="Usuarios">
                    <h1 className="pin-title">{branchName ?? 'Elige tu usuario'}</h1>
                    {branchName && <p className="pin-sub">Elige tu usuario</p>}
                    {loadFailed && (
                        <div className="form">
                            <p className="error" role="alert">No se pudo cargar la lista.</p>
                            <button type="button" className="btn" onClick={loadRoster}>Reintentar</button>
                        </div>
                    )}
                    {!loadFailed && roster === null && <p className="muted">Cargando…</p>}
                    <div className="pin-grid">
                        {roster?.map((u) => (
                            <button
                                key={u.id}
                                type="button"
                                className="avatar"
                                aria-label={u.name}
                                aria-pressed={selected?.id === u.id}
                                onClick={() => {
                                    setSelected(u);
                                    setPin('');
                                    setError(false);
                                }}
                            >
                                <span className="avatar-disc">{u.initials}</span>
                                <span className="avatar-name">{u.name.split(' ')[0]}</span>
                                {pendingBy[u.id] && pendingText(pendingBy[u.id]) && <span className="avatar-pending">{pendingText(pendingBy[u.id])}</span>}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="pin-pad" aria-label="PIN">
                    <p className="pin-pad-title">{selected ? `PIN de ${selected.name.split(' ')[0]}` : 'Elige un usuario'}</p>
                    <div className="pin-dots" data-testid="pin-dots" data-filled={pin.length}>
                        {Array.from({ length: MAX_DIGITS }, (_, i) => (
                            <span key={i} className={i < pin.length ? 'pin-dot on' : 'pin-dot'} />
                        ))}
                    </div>
                    {error && <p className="error" role="alert" style={{ textAlign: 'center' }}>No se pudo iniciar sesión</p>}
                    <div className="keypad">
                        {DIGITS.map((d) => (
                            <button key={d} type="button" className="key" disabled={!selected || busy} onClick={() => press(d)}>{d}</button>
                        ))}
                        <button type="button" className="key" aria-label="Borrar" disabled={!selected || busy || !pin} onClick={() => setPin((p) => p.slice(0, -1))}>
                            <IconBackspace size={20} stroke={1.5} aria-hidden />
                        </button>
                        <button type="button" className="key" disabled={!selected || busy} onClick={() => press('0')}>0</button>
                        <span />
                    </div>
                    <button type="button" className="btn btn-primary" disabled={!selected || busy || pin.length < MIN_DIGITS} onClick={() => void submit()}>
                        Entrar
                    </button>
                </section>
            </div>
        </div>
    );
}
