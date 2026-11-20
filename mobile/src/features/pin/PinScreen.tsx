import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../../core/session';
import { httpStatus } from '../../core/httpErrors';
import type { PinApi, RosterUser } from './pinApi';

const MIN_DIGITS = 4;
const MAX_DIGITS = 6;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface Props {
    api: PinApi;
    onLoggedIn: (session: Session) => void;
    /** The server rejected the device token itself: the device was revoked. */
    onRevoked: () => void;
}

export function PinScreen({ api, onLoggedIn, onRevoked }: Props) {
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
            <section className="pin-roster" aria-label="Usuarios">
                {loadFailed && (
                    <div className="form">
                        <p className="error" role="alert">No se pudo cargar la lista.</p>
                        <button type="button" className="btn" onClick={loadRoster}>Reintentar</button>
                    </div>
                )}
                {!loadFailed && roster === null && <p className="muted">Cargando…</p>}
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
                        <span className="avatar-disc" style={u.color ? { background: u.color } : undefined}>{u.initials}</span>
                        <span>{u.name.split(' ')[0]}</span>
                    </button>
                ))}
            </section>

            <section className="pin-pad" aria-label="PIN">
                <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
                    {selected ? selected.name : 'Elige tu usuario'}
                </p>
                <div className="pin-dots" data-testid="pin-dots" data-filled={pin.length}>
                    {Array.from({ length: MAX_DIGITS }, (_, i) => (
                        <span key={i} className={i < pin.length ? 'pin-dot on' : 'pin-dot'} />
                    ))}
                </div>
                {error && <p className="error" role="alert" style={{ textAlign: 'center' }}>No se pudo iniciar sesión</p>}
                <div className="keypad">
                    {DIGITS.map((d) => (
                        <button key={d} type="button" className="btn" disabled={!selected || busy} onClick={() => press(d)}>{d}</button>
                    ))}
                    <button type="button" className="btn" aria-label="Borrar" disabled={!selected || busy || !pin} onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
                    <button type="button" className="btn" disabled={!selected || busy} onClick={() => press('0')}>0</button>
                    <span />
                </div>
                <button type="button" className="btn btn-primary" disabled={!selected || busy || pin.length < MIN_DIGITS} onClick={() => void submit()}>
                    Entrar
                </button>
            </section>
        </div>
    );
}
