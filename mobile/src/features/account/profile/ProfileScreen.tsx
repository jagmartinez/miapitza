import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import type { AccountApi } from '../accountApi';
import { useAccountNav } from '../AccountNav';
import { ChangePasswordScreen } from '../ChangePasswordScreen';
import { toHrError, type HrApi, type HrEmployeeSummary } from '../hrApi';
import { PinSetupSheet } from './PinSetupSheet';
import './profile.css';

interface Props {
    hr: HrApi;
    accountApi: Pick<AccountApi, 'changePassword'>;
    /** The server revoked every session after a voluntary password change: back to login. */
    onPasswordChanged: () => void;
    onLogout: () => void;
}

interface Form {
    phone: string;
    email: string;
    address: string;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const dateLabel = (v: string | null) => {
    if (!v) return '—';
    const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-NI');
};

export function ProfileScreen({ hr, accountApi, onPasswordChanged, onLogout }: Props) {
    const { back } = useAccountNav();
    const toast = useToast();
    const [employee, setEmployee] = useState<HrEmployeeSummary | null>(null);
    const [form, setForm] = useState<Form | null>(null);
    const [initial, setInitial] = useState<Form | null>(null);
    const [pinFailed, setPinFailed] = useState(false);
    const [pin, setPin] = useState<{ hasPin: boolean; canUsePin: boolean }>({ hasPin: false, canUsePin: false });
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<'main' | 'password'>('main');
    const [sheet, setSheet] = useState(false);
    const saveBusy = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        const [emp, prof, me] = await Promise.allSettled([hr.myEmployee(), hr.profile(), hr.authMe()]);
        if (emp.status === 'fulfilled') setEmployee(emp.value);
        if (prof.status === 'fulfilled') {
            const f = { phone: text(prof.value.phone), email: text(prof.value.email), address: text(prof.value.address) };
            setForm(f);
            setInitial(f);
        } else setFailed(true);
        setPinFailed(me.status === 'rejected');
        if (me.status === 'fulfilled') setPin({ hasPin: me.value.hasPin === true, canUsePin: me.value.canUsePin === true });
    }, [hr]);
    useEffect(() => {
        void load();
    }, [load]);

    async function save() {
        if (!form || !initial || saveBusy.current) return;
        // Only what changed: an empty field that was already empty is never sent.
        const body: Partial<Form> = {};
        for (const k of ['phone', 'email', 'address'] as const) if (form[k].trim() !== initial[k]) body[k] = form[k].trim();
        if (!Object.keys(body).length) return toast.show('No hay cambios que guardar');
        if (body.email === '') return toast.show('El correo no puede quedar vacío', 'error');
        saveBusy.current = true;
        setSaving(true);
        try {
            // Whitelist: only what the employee may edit about themselves.
            await hr.updateProfile(body);
            setInitial({ ...initial, ...body });
            setForm({ ...form, ...body });
            toast.show('Datos guardados');
        } catch (e) {
            toast.show(toHrError(e).message, 'error');
        } finally {
            saveBusy.current = false;
            setSaving(false);
        }
    }

    async function savePin(value: string, currentPassword: string) {
        await hr.setPin(value, currentPassword);
        setPin((p) => ({ ...p, hasPin: true }));
        setSheet(false);
        toast.show('PIN guardado');
    }

    if (view === 'password') {
        return <ChangePasswordScreen api={accountApi} onChanged={onPasswordChanged} onLogout={onLogout} onBack={() => setView('main')} />;
    }

    const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
    return (
        <main className="ah">
            <ScreenHeader title="Mi información" onBack={back} />
            <div className="ah-body">
                {employee && (
                    <Card title={employee.fullName}>
                        <div className="pf-list">
                            <div className="pf-row"><span>Código</span><span>{employee.code}</span></div>
                            <div className="pf-row"><span>Puesto</span><span>{employee.position ?? '—'}</span></div>
                            <div className="pf-row"><span>Sucursal</span><span>{employee.branchName ?? '—'}</span></div>
                            <div className="pf-row"><span>Ingreso</span><span>{dateLabel(employee.hireDate)}</span></div>
                            {employee.emergencyContactName && (
                                <div className="pf-row"><span>Emergencia</span><span>{`${employee.emergencyContactName} ${employee.emergencyContactPhone ?? ''}`.trim()}</span></div>
                            )}
                        </div>
                    </Card>
                )}
                {failed && (
                    <div>
                        <p role="alert" className="pf-error">No se pudieron cargar tus datos.</p>
                        <button type="button" className="btn" onClick={() => void load()}>Reintentar</button>
                    </div>
                )}
                {form && (
                    <Card title="Mis datos de contacto">
                        <div className="pf-form">
                            <label className="field">Teléfono
                                <input type="tel" value={form.phone} onChange={set('phone')} />
                            </label>
                            <label className="field">Correo
                                <input type="email" value={form.email} onChange={set('email')} />
                            </label>
                            <label className="field">Dirección
                                <input type="text" value={form.address} onChange={set('address')} />
                            </label>
                            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>Guardar</button>
                        </div>
                    </Card>
                )}
                <div className="pf-actions">
                    <button type="button" className="btn" onClick={() => setView('password')}>Cambiar contraseña</button>
                    {pinFailed && (
                        <div>
                            <p role="alert" className="pf-error">No se pudo cargar el estado del PIN</p>
                            <button type="button" className="btn" onClick={() => void load()}>Reintentar</button>
                        </div>
                    )}
                    {pin.canUsePin && (
                        <button type="button" className="btn" onClick={() => setSheet(true)}>{pin.hasPin ? 'Cambiar PIN' : 'Definir PIN'}</button>
                    )}
                    <button type="button" className="btn" onClick={onLogout}>Cerrar sesión</button>
                </div>
            </div>
            {sheet && <PinSetupSheet hasPin={pin.hasPin} onSubmit={savePin} onClose={() => setSheet(false)} />}
        </main>
    );
}
