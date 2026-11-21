import { useState, type FormEvent } from 'react';
import type { AccountApi } from './accountApi';

interface Props {
    api: Pick<AccountApi, 'changePassword'>;
    /** The server revoked every session: the caller returns to login. */
    onChanged: () => void;
    onLogout: () => void;
}

const MIN = 8;
const MAX = 128;

function serverMessage(e: unknown): string {
    const message = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof message === 'string' && message ? message : 'No se pudo cambiar la contraseña';
}

/** Blocking screen: no back button; the only exits are changing the password or "Cerrar sesión". */
export function ChangePasswordScreen({ api, onChanged, onLogout }: Props) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [repeat, setRepeat] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (busy) return;
        if (next.length < MIN || next.length > MAX) {
            setError(`La contraseña debe tener entre ${MIN} y ${MAX} caracteres`);
            return;
        }
        if (next !== repeat) {
            setError('Las contraseñas no coinciden');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.changePassword(current, next);
            onChanged();
        } catch (err) {
            setError(serverMessage(err));
            setBusy(false);
        }
    }

    return (
        <main className="screen">
            <form className="form" onSubmit={(e) => void submit(e)}>
                <h1>Cambia tu contraseña</h1>
                <p className="muted">Debes cambiarla para continuar.</p>
                <label className="field">Contraseña actual
                    <input type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
                </label>
                <label className="field">Nueva contraseña
                    <input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
                </label>
                <label className="field">Repite la nueva contraseña
                    <input type="password" value={repeat} autoComplete="new-password" onChange={(e) => setRepeat(e.target.value)} />
                </label>
                {error && <p className="error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary" disabled={busy || !current || !next || !repeat}>Cambiar contraseña</button>
                <button type="button" className="btn" onClick={onLogout}>Cerrar sesión</button>
            </form>
        </main>
    );
}
