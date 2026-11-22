import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeviceType, LoginUser } from '../../core/session';
import { httpMessage, httpStatus } from '../../core/httpErrors';
import type { DeviceApi, SetupBranch } from './deviceApi';

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
    const [branches, setBranches] = useState<SetupBranch[] | null>(null);
    const [optionsState, setOptionsState] = useState<'loading' | 'error' | 'ready'>('loading');
    const [branchSel, setBranchSel] = useState('');
    const [kitchenSel, setKitchenSel] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Bumped when the admin leaves the login step; a late login result is then ignored.
    const loginSeq = useRef(0);
    // Same idea for the setup-options request: bumped on every load and whenever the details step is left.
    const optionsSeq = useRef(0);

    async function loadOptions(preferredBranch: number | null) {
        const seq = ++optionsSeq.current;
        setOptionsState('loading');
        try {
            const list = await api.setupOptions();
            if (seq !== optionsSeq.current) return;
            setBranches(list);
            setBranchSel(preferredBranch != null && list.some((b) => b.id === preferredBranch) ? String(preferredBranch) : '');
            setKitchenSel('');
            setOptionsState('ready');
        } catch (err) {
            if (seq !== optionsSeq.current) return;
            const status = httpStatus(err);
            if (status === 401 || status === 403) {
                optionsSeq.current++;
                await api.cancel();
                setAdmin(null);
                setNeedsCode(false);
                setPassword('');
                setStep('login');
                setError(status === 403 ? 'Este usuario no puede registrar dispositivos' : 'La sesión expiró, vuelve a iniciar sesión');
                return;
            }
            setOptionsState('error');
        }
    }

    const branchList = branches ?? [];
    const selectedBranch = branchList.length === 1 ? branchList[0] : branchList.find((b) => String(b.id) === branchSel) ?? null;
    const kitchenUsers = selectedBranch?.kitchenUsers ?? [];
    const kitchenUser = kitchenUsers.length === 1 ? kitchenUsers[0] : kitchenUsers.find((u) => String(u.id) === kitchenSel) ?? null;
    const isKitchen = type === 'KITCHEN_TABLET';
    const noKitchenUsers = isKitchen && selectedBranch != null && kitchenUsers.length === 0;
    const canRegister = optionsState === 'ready' && selectedBranch != null && !noKitchenUsers && (!isKitchen || kitchenUser != null);

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
                void loadOptions(result.user.branchId ?? null);
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
        if (!name.trim() || !selectedBranch) {
            setError('Completa los datos del dispositivo');
            return;
        }
        if (isKitchen && !kitchenUser) {
            setError('Indica el usuario de cocina');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.register({ branchId: selectedBranch.id, type, name: name.trim(), kitchenUserId: isKitchen ? kitchenUser?.id : undefined });
            onDone(type);
        } catch (err) {
            const status = httpStatus(err);
            // Do not keep the admin token around while the form sits open.
            optionsSeq.current++;
            await api.cancel();
            setAdmin(null);
            setNeedsCode(false);
            setPassword('');
            setStep('login');
            // A 400 is the server telling the admin what to fix (e.g. an inactive kitchen user): show it.
            setError(status === 403 ? 'Este usuario no puede registrar dispositivos' : (status === 400 && httpMessage(err)) || 'No se pudo registrar el dispositivo');
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
                {optionsState === 'loading' && <p className="muted" style={{ margin: 0 }}>Cargando…</p>}
                {optionsState === 'error' && (
                    <>
                        <p className="error" role="alert">No se pudieron cargar las sucursales</p>
                        <button type="button" className="btn" onClick={() => void loadOptions(admin?.branchId ?? null)}>Reintentar</button>
                    </>
                )}
                {optionsState === 'ready' && branchList.length === 0 && <p className="error" role="alert">No tienes sucursales disponibles</p>}
                {optionsState === 'ready' && branchList.length === 1 && <p style={{ margin: 0 }}>Sucursal: {branchList[0].name}</p>}
                {optionsState === 'ready' && branchList.length > 1 && (
                    <label className="field">Sucursal
                        <select value={branchSel} onChange={(e) => { setBranchSel(e.target.value); setKitchenSel(''); }}>
                            <option value="">Elige una sucursal</option>
                            {branchList.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                        </select>
                    </label>
                )}
                {isKitchen && selectedBranch && kitchenUsers.length > 0 && (
                    <label className="field">Usuario de cocina
                        <select value={kitchenUser ? String(kitchenUser.id) : ''} onChange={(e) => setKitchenSel(e.target.value)}>
                            {!kitchenUser && <option value="">Elige el usuario de cocina</option>}
                            {kitchenUsers.map((u) => <option key={u.id} value={String(u.id)}>{u.name} ({u.username})</option>)}
                        </select>
                    </label>
                )}
                {noKitchenUsers && <p className="error">Esta sucursal no tiene usuarios de cocina activos. Créalo o actívalo en Usuarios (web).</p>}
                {error && <p className="error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary" disabled={busy || !canRegister}>Registrar dispositivo</button>
                <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                        optionsSeq.current++;
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
