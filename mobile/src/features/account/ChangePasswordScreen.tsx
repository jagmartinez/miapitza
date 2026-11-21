import { useState, type FormEvent } from 'react';
import { ScreenHeader } from '../../ui/ScreenHeader';
import type { AccountApi } from './accountApi';

interface Props {
    api: Pick<AccountApi, 'changePassword'>;
    /** The server revoked every session: the caller returns to login. */
    onChanged: () => void;
    onLogout: () => void;
    /** Voluntary change from "Mi información": shows a back button and no forced-logout exit. Absent = blocking. */
    onBack?: () => void;
}

const MIN = 8;
const MAX = 128;

function serverMessage(e: unknown): string {
    const message = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof message === 'string' && message ? message : 'No se pudo cambiar la contraseña';
}

/** Blocking screen: no back button; the only exits are changing the password or "Cerrar sesión". */
export function ChangePasswordScreen({ api, onChanged, onLogout, onBack }: Props) {
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
        <main className={onBack ? undefined : 'screen'}>
            {onBack && <ScreenHeader title="Cambiar contraseña" onBack={onBack} />}
            <form className="form" style={onBack ? { padding: 16 } : undefined} onSubmit={(e) => void submit(e)}>
                {!onBack && <h1>Cambia tu contraseña</h1>}
                {!onBack && <p className="muted">Debes cambiarla para continuar.</p>}
                {onBack && <p className="muted">Al cambiarla se cerrarán todas tus sesiones y deberás iniciar sesión de nuevo.</p>}
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
                {!onBack && <button type="button" className="btn" onClick={onLogout}>Cerrar sesión</button>}
            </form>
        </main>
    );
}
