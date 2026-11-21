import { useState, type FormEvent } from 'react';
import type { Session } from '../../core/session';
import type { AccountApi } from './accountApi';

interface Props {
    api: AccountApi;
    onLoggedIn: (session: Session) => void;
    /** Informational line above the form (session expired, password changed). */
    notice?: string | null;
}

/** Username + password (+ 2FA when the server asks) for personal phones. */
export function LoginScreen({ api, onLoggedIn, notice }: Props) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [needsCode, setNeedsCode] = useState(false);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(false);
        try {
            const result = await api.login(username.trim(), password, needsCode ? code.trim() : undefined);
            if (result.status === '2fa') {
                setNeedsCode(true);
                setBusy(false);
            } else {
                onLoggedIn(result.session);
            }
        } catch {
            setError(true);
            setPassword('');
            setBusy(false);
        }
    }

    return (
        <main className="screen">
            <form className="form" onSubmit={(e) => void submit(e)}>
                <h1>Mia Pitza Ops</h1>
                {notice && <p className="muted" role="status">{notice}</p>}
                <label className="field">Usuario
                    <input value={username} autoCapitalize="none" autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
                </label>
                <label className="field">Contraseña
                    <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
                </label>
                {needsCode && (
                    <label className="field">Código 2FA
                        <input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(e) => setCode(e.target.value)} />
                    </label>
                )}
                {error && <p className="error" role="alert">No se pudo iniciar sesión</p>}
                <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>Entrar</button>
            </form>
        </main>
    );
}
