import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeviceType, LoginUser } from '../../core/session';
import { httpStatus } from '../../core/httpErrors';
import type { DeviceApi } from './deviceApi';

interface Props {
    api: DeviceApi;
    onDone: (type: DeviceType) => void;
}

type Step = 'type' | 'login' | 'details';

export function DeviceSetupScreen({ api, onDone }: Props) {
    const [step, setStep] = useState<Step>('type');
    const [type, setType] = useState<DeviceType>('SERVICE_TABLET');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [needsCode, setNeedsCode] = useState(false);
    const [admin, setAdmin] = useState<LoginUser | null>(null);
    const [name, setName] = useState('');
    const [branchId, setBranchId] = useState('');
    const [kitchenUserId, setKitchenUserId] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Bumped when the admin leaves the login step; a late login result is then ignored.
    const loginSeq = useRef(0);

    // Leaving setup for any reason must not leave an admin session alive.
    const apiRef = useRef(api);
    useEffect(() => {
        const current = apiRef.current;
        return () => void current.cancel();
    }, []);

    async function choose(next: DeviceType) {
        setType(next);
        setError(null);
        if (next === 'PERSONAL') {
            try {
                await api.register({ branchId: 0, type: 'PERSONAL', name: '' });
                onDone('PERSONAL');
            } catch {
                setError('No se pudo guardar la configuración');
            }
            return;
        }
        setStep('login');
    }

    async function login(e: FormEvent) {
        e.preventDefault();
        if (busy) return;
        const seq = ++loginSeq.current;
        setBusy(true);
        setError(null);
        try {
            const result = await api.adminLogin(username.trim(), password, needsCode ? code.trim() : undefined);
            if (seq !== loginSeq.current || result.status === 'cancelled') return;
            if (result.status === '2fa') {
                setNeedsCode(true);
            } else {
                setAdmin(result.user);
                setPassword('');
                setCode('');
                setStep('details');
            }
        } catch {
            if (seq === loginSeq.current) setError('No se pudo iniciar sesión');
        } finally {
            if (seq === loginSeq.current) setBusy(false);
        }
    }

    async function register(e: FormEvent) {
        e.preventDefault();
        if (busy || !admin) return;
        const branch = admin.branchId ?? Number(branchId);
        if (!name.trim() || !Number.isInteger(branch) || branch < 1) {
            setError('Completa los datos del dispositivo');
            return;
        }
        let kitchen: number | undefined;
        if (type === 'KITCHEN_TABLET') {
            kitchen = Number(kitchenUserId);
            if (!Number.isInteger(kitchen) || kitchen < 1) {
                setError('Indica el usuario de cocina');
                return;
            }
        }
        setBusy(true);
        setError(null);
        try {
            await api.register({ branchId: branch, type, name: name.trim(), kitchenUserId: kitchen });
            onDone(type);
        } catch (err) {
            const status = httpStatus(err);
            // Do not keep the admin token around while the form sits open.
            await api.cancel();
            setAdmin(null);
            setNeedsCode(false);
            setStep('login');
            setError(status === 403 ? 'Este usuario no puede registrar dispositivos' : 'No se pudo registrar el dispositivo');
            setBusy(false);
        }
    }

    if (step === 'type') {
        return (
            <main className="screen">
                <form className="form" onSubmit={(e) => e.preventDefault()}>
                    <h1>¿Qué es este dispositivo?</h1>
                    <button type="button" className="btn" onClick={() => void choose('SERVICE_TABLET')}>Tablet de servicio</button>
                    <button type="button" className="btn" onClick={() => void choose('KITCHEN_TABLET')}>Tablet de cocina</button>
                    <button type="button" className="btn" onClick={() => void choose('PERSONAL')}>Personal</button>
                    {error && <p className="error" role="alert">{error}</p>}
                </form>
            </main>
        );
    }

    if (step === 'login') {
        return (
            <main className="screen">
                <form className="form" onSubmit={(e) => void login(e)}>
                    <h1>Acceso de administrador</h1>
                    <p className="muted" style={{ margin: 0 }}>Solo para registrar este dispositivo.</p>
                    <label className="field">Usuario
                        <input value={username} autoCapitalize="none" autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
                    </label>
                    <label className="field">Contraseña
                        <input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} />
                    </label>
                    {needsCode && (
                        <label className="field">Código 2FA
                            <input value={code} inputMode="numeric" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
                        </label>
                    )}
                    {error && <p className="error" role="alert">{error}</p>}
                    <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>Continuar</button>
                    <button type="button" className="btn" onClick={() => { loginSeq.current++; setBusy(false); setStep('type'); setNeedsCode(false); setError(null); void api.cancel(); }}>Atrás</button>
                </form>
            </main>
        );
    }

    return (
        <main className="screen">
            <form className="form" onSubmit={(e) => void register(e)}>
                <h1>{type === 'KITCHEN_TABLET' ? 'Tablet de cocina' : 'Tablet de servicio'}</h1>
                <label className="field">Nombre del dispositivo
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                {admin?.branchId == null && (
                    <label className="field">Sucursal (ID)
                        <input value={branchId} inputMode="numeric" onChange={(e) => setBranchId(e.target.value)} />
                    </label>
                )}
                {type === 'KITCHEN_TABLET' && (
                    <label className="field">Usuario de cocina (ID)
                        <input value={kitchenUserId} inputMode="numeric" onChange={(e) => setKitchenUserId(e.target.value)} />
                    </label>
                )}
                {error && <p className="error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary" disabled={busy}>Registrar dispositivo</button>
                <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                        void api.cancel();
                        setAdmin(null);
                        setNeedsCode(false);
                        setError(null);
                        setStep('type');
                    }}
                >
                    Cancelar
                </button>
            </form>
        </main>
    );
}
