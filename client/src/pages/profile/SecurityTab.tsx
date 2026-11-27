import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, LogOut, Lock, Monitor, Shield, ShieldCheck, Smartphone, X } from 'lucide-react';
import { authAPI, usersAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import {
    Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, IconButton, Input, LoadErrorState, type Column, type Tone,
} from '@/ui';
import { axiosErr } from './profileHelpers';

export interface PasswordInfoState {
    passwordChangedAt?: string | null;
    daysUntilExpiry: number | null;
    expiryDays: number;
}

export interface RolePermissionRow {
    id: number;
    name: string;
    description?: string;
}

interface SessionRow {
    id: string;
    device?: string;
    isCurrent?: boolean;
    ipAddress?: string;
    createdAt: string;
}

type TwoFactorStatus = 'loading' | 'unavailable' | 'off' | 'setup' | 'on';

const PWD_RULES = [
    { id: 'len', label: 'Mínimo 8 caracteres', test: (p: string) => p.length >= 8 },
    { id: 'up', label: 'Una mayúscula', test: (p: string) => /[A-Z]/.test(p) },
    { id: 'low', label: 'Una minúscula', test: (p: string) => /[a-z]/.test(p) },
    { id: 'num', label: 'Un número', test: (p: string) => /\d/.test(p) },
    { id: 'sym', label: 'Un símbolo (!@#$%...)', test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

const ROLE_CAPS: Record<string, string[]> = {
    SUPERADMIN: ['Acceso total al sistema', 'Gestión de empresas y sucursales', 'Administración de usuarios y roles', 'Configuración del sistema', 'Reportes y estadísticas', 'Gestión de menú, inventario y compras', 'POS y operaciones de caja', 'Catering y reservaciones'],
    ADMIN: ['Administración de usuarios y roles', 'Configuración del sistema', 'Reportes y estadísticas', 'Gestión de menú, inventario y compras', 'POS y operaciones de caja', 'Catering y reservaciones', 'Gestión de sucursales'],
    CHEF: ['Pantalla de cocina', 'Gestión de menú y categorías', 'Inventario y proveedores', 'Órdenes de compra (lectura)', 'Dashboard de cocina e inventario'],
    CAJERO: ['Punto de Venta (POS)', 'Gestión de caja y turnos', 'Facturación y pagos', 'Órdenes', 'Reservaciones y catering', 'Dashboard de caja'],
    MESERO: ['Punto de Venta (POS)', 'Gestión de mesas', 'Crear y enviar órdenes a cocina', 'Pantalla de cocina', 'Dashboard personal de ventas'],
    HOST: ['Gestión de mesas', 'Reservaciones', 'Dashboard de reservas'],
    COCINA: ['Pantalla de cocina', 'Dashboard de cocina'],
    BODEGA: ['Inventario y kardex', 'Proveedores', 'Órdenes de compra', 'Movimientos de inventario', 'Dashboard de bodega'],
};

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('es-MX');

// ── Salud de la cuenta ──
function expiryTone(days: number | null): Tone {
    if (days === null) return 'neutral';
    return days <= 15 ? 'danger' : days <= 30 ? 'warning' : 'success';
}

function AccountHealth({ passwordInfo, twoFactor, sessionCount }: {
    passwordInfo: PasswordInfoState | null;
    twoFactor: TwoFactorStatus;
    sessionCount: number | null;
}) {
    const passwordText = !passwordInfo
        ? 'No disponible'
        : passwordInfo.expiryDays === 0 || passwordInfo.daysUntilExpiry === null
            ? 'Sin expiración'
            : `Expira en ${passwordInfo.daysUntilExpiry} días`;
    const passwordSub = passwordInfo
        ? passwordInfo.passwordChangedAt
            ? `Último cambio: ${new Date(passwordInfo.passwordChangedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : 'Último cambio: nunca'
        : 'No pudimos consultar la política de contraseña.';
    const twoFactorText = twoFactor === 'on' ? 'Activada' : twoFactor === 'off' || twoFactor === 'setup' ? 'Desactivada' : twoFactor === 'loading' ? 'Consultando…' : 'No disponible';
    const twoFactorTone: Tone = twoFactor === 'on' ? 'success' : twoFactor === 'off' || twoFactor === 'setup' ? 'warning' : 'neutral';
    return (
        <dl className="profile-health" aria-label="Salud de la cuenta">
            <div>
                <dt>Contraseña</dt>
                <dd><Badge tone={expiryTone(passwordInfo?.daysUntilExpiry ?? null)} dot>{passwordText}</Badge></dd>
                <dd className="profile-health__sub">{passwordSub}</dd>
            </div>
            <div>
                <dt>Verificación en dos pasos</dt>
                <dd><Badge tone={twoFactorTone} dot>{twoFactorText}</Badge></dd>
                <dd className="profile-health__sub">{twoFactor === 'off' ? 'Tu cuenta solo está protegida con contraseña.' : twoFactor === 'on' ? 'Tu cuenta tiene doble protección.' : ' '}</dd>
            </div>
            <div>
                <dt>Sesiones abiertas</dt>
                <dd><Badge tone={sessionCount === null ? 'neutral' : sessionCount > 1 ? 'warning' : 'success'} dot>{sessionCount === null ? 'No disponible' : String(sessionCount)}</Badge></dd>
                <dd className="profile-health__sub">{sessionCount !== null && sessionCount > 1 ? 'Revisa que reconozcas cada dispositivo.' : ' '}</dd>
            </div>
        </dl>
    );
}

// ── Contraseña ──
function PasswordSection({ logout }: { logout: () => void }) {
    const [oldPwd, setOldPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    const allValid = PWD_RULES.every(r => r.test(newPwd));
    const match = newPwd === confirmPwd && confirmPwd.length > 0;
    const canSubmit = oldPwd.length > 0 && allValid && match && !saving;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setMsg(null); setSaving(true);
        try {
            await authAPI.changePassword(oldPwd, newPwd);
            setSuccess(true);
            setTimeout(() => logout(), 2500);
        } catch (err: unknown) {
            setMsg({ type: 'error', text: axiosErr(err, 'Error al cambiar contraseña') });
        } finally { setSaving(false); }
    };

    if (success) {
        return (
            <EmptyState icon={ShieldCheck} title="Contraseña actualizada" description="Serás redirigido al inicio de sesión..." />
        );
    }

    return (
        <form onSubmit={handleSubmit} className="profile-form" aria-label="Cambiar contraseña">
            <p className="profile-note">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</p>
            {msg && <div className={`profile-msg ${msg.type}`} role={msg.type === 'error' ? 'alert' : 'status'}>{msg.text}</div>}

            <Field label="Contraseña actual" htmlFor="profile-current-password">
                <Input
                    id="profile-current-password" name="currentPassword" autoComplete="current-password"
                    type={showOld ? 'text' : 'password'} value={oldPwd} onChange={e => setOldPwd(e.target.value)}
                    placeholder="Contraseña actual"
                    suffix={<IconButton icon={showOld ? EyeOff : Eye} size="sm" label={showOld ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'} aria-pressed={showOld} onClick={() => setShowOld(!showOld)} />}
                />
            </Field>

            <Field label="Nueva contraseña" htmlFor="profile-new-password">
                <Input
                    id="profile-new-password" name="newPassword" autoComplete="new-password"
                    type={showNew ? 'text' : 'password'} value={newPwd} onChange={e => setNewPwd(e.target.value)}
                    placeholder="Nueva contraseña"
                    suffix={<IconButton icon={showNew ? EyeOff : Eye} size="sm" label={showNew ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'} aria-pressed={showNew} onClick={() => setShowNew(!showNew)} />}
                />
            </Field>

            <ul className="profile-rules" aria-label="Requisitos de la contraseña">
                {PWD_RULES.map(r => (
                    <li key={r.id} className={r.test(newPwd) ? 'pass' : newPwd.length > 0 ? 'fail' : ''}>
                        {r.test(newPwd) ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                        <span>{r.label}</span>
                    </li>
                ))}
            </ul>

            <Field label="Confirmar nueva contraseña" htmlFor="profile-confirm-password" error={confirmPwd.length > 0 && !match ? 'No coinciden' : undefined}>
                <Input
                    id="profile-confirm-password" name="confirmPassword" autoComplete="new-password" type="password"
                    value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder="Repite la nueva contraseña"
                />
            </Field>

            <div className="profile-form__footer">
                <Button type="submit" variant="primary" icon={Lock} disabled={!canSubmit} loading={saving}>
                    {saving ? 'Cambiando...' : 'Cambiar Contraseña'}
                </Button>
            </div>
        </form>
    );
}

// ── 2FA ──
function TwoFactorSection({ onStatus }: { onStatus(status: TwoFactorStatus): void }) {
    const { user } = useAuth();
    const [status, setStatusState] = useState<TwoFactorStatus>('loading');
    const [qrCode, setQrCode] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const setStatus = useCallback((next: TwoFactorStatus) => {
        setStatusState(next);
        onStatus(next);
    }, [onStatus]);

    const checkStatus = useCallback(async () => {
        setError('');
        setStatus('loading');
        try {
            if (!user?.id) {
                setStatus('unavailable');
                setError('No se pudo identificar la cuenta para consultar el estado de 2FA.');
                return;
            }
            const userRes = await usersAPI.getById(user.id);
            const enabled = Boolean(userRes.data?.data?.twoFactorEnabled);
            setStatus(enabled ? 'on' : 'off');
        } catch (err: unknown) {
            // Desconocido no es lo mismo que desactivado: no se ofrece activar con una lectura fallida.
            setStatus('unavailable');
            setError(axiosErr(err, 'No se pudo consultar el estado de 2FA.'));
        }
    }, [user?.id, setStatus]);

    useEffect(() => { void checkStatus(); }, [checkStatus]);

    const handleSetup = async () => {
        setError('');
        try {
            const res = await authAPI.setup2FA();
            setQrCode(res.data.data.qrCodeDataUrl);
            setStatus('setup');
        } catch (err: unknown) {
            setError(axiosErr(err, 'Error al configurar 2FA'));
        }
    };

    const handleVerify = async () => {
        if (code.length !== 6) return;
        setError(''); setSaving(true);
        try {
            await authAPI.verify2FA(code);
            setStatus('on');
            setCode('');
        } catch (err: unknown) {
            setError(axiosErr(err, 'Código inválido'));
        } finally { setSaving(false); }
    };

    const handleDisable = async () => {
        if (code.length !== 6) return;
        setError(''); setSaving(true);
        try {
            await authAPI.disable2FA(code);
            setStatus('off');
            setCode('');
            setQrCode('');
        } catch (err: unknown) {
            setError(axiosErr(err, 'Código inválido'));
        } finally { setSaving(false); }
    };

    return (
        <div className="profile-twofa">
            <p className="profile-note">Agrega una capa extra de seguridad usando Google Authenticator, Authy u otra app TOTP.</p>
            {error && <div className="profile-msg error" role="alert">{error}</div>}

            {status === 'loading' && <p className="profile-note" role="status">Cargando estado de seguridad…</p>}

            {status === 'unavailable' && (
                <div className="profile-row">
                    <div>
                        <strong>Estado de 2FA no disponible</strong>
                        <p className="profile-note">No se habilitarán cambios hasta confirmar el estado actual.</p>
                    </div>
                    <Button variant="secondary" onClick={() => void checkStatus()}>Reintentar</Button>
                </div>
            )}

            {status === 'off' && (
                <div className="profile-row">
                    <div>
                        <strong>2FA desactivado</strong>
                        <p className="profile-note">Tu cuenta solo está protegida con contraseña.</p>
                    </div>
                    <Button variant="primary" icon={Shield} onClick={handleSetup}>Activar 2FA</Button>
                </div>
            )}

            {status === 'setup' && (
                <div className="profile-twofa__setup">
                    <p><strong>1. Escanea este código QR con tu app de autenticación:</strong></p>
                    {qrCode && <img src={qrCode} alt="QR Code" className="profile-twofa__qr" />}
                    <p><strong>2. Ingresa el código de 6 dígitos que muestra la app:</strong></p>
                    <div className="profile-inline">
                        <Input
                            id="profile-2fa-setup-code" name="twoFactorCode" type="text" inputMode="numeric" autoComplete="one-time-code"
                            maxLength={6} placeholder="000000" aria-label="Código de verificación de 6 dígitos"
                            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        />
                        <Button variant="primary" onClick={handleVerify} disabled={code.length !== 6} loading={saving}>
                            {saving ? 'Verificando...' : 'Verificar y Activar'}
                        </Button>
                    </div>
                </div>
            )}

            {status === 'on' && (
                <div className="profile-row">
                    <div>
                        <strong>2FA activado</strong>
                        <p className="profile-note">Tu cuenta tiene doble protección.</p>
                    </div>
                    <div className="profile-inline">
                        <Input
                            id="profile-2fa-disable-code" name="twoFactorDisableCode" type="text" inputMode="numeric" autoComplete="one-time-code"
                            maxLength={6} placeholder="Código para desactivar" aria-label="Código de 6 dígitos para desactivar 2FA"
                            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        />
                        <Button variant="danger" onClick={handleDisable} disabled={code.length !== 6 || saving}>Desactivar</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sesiones y accesos ──
function SessionsSection({ sessions, loading, failed, reload }: {
    sessions: SessionRow[];
    loading: boolean;
    failed: boolean;
    reload(): void;
}) {
    const [pending, setPending] = useState<{ kind: 'one'; id: string } | { kind: 'all' } | null>(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const confirm = async () => {
        if (!pending) return;
        setBusy(true);
        setActionError('');
        try {
            if (pending.kind === 'one') await authAPI.revokeSession(pending.id);
            else await authAPI.revokeAllSessions();
            setPending(null);
            reload();
        } catch (err: unknown) {
            setActionError(axiosErr(err, 'No se pudo cerrar la sesión.'));
            setPending(null);
        } finally { setBusy(false); }
    };

    const columns: Column<SessionRow>[] = [
        {
            key: 'device', header: 'Dispositivo', width: '1.4fr',
            render: (s) => (
                <span className="profile-device">
                    {s.device === 'Móvil' ? <Smartphone size={16} aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}
                    {s.device || 'Navegador'}
                    {s.isCurrent ? <Badge tone="success" dot>Sesión actual</Badge> : null}
                </span>
            ),
        },
        { key: 'ipAddress', header: 'IP', render: (s) => s.ipAddress || 'No disponible' },
        { key: 'createdAt', header: 'Inicio', render: (s) => fmtDateTime(s.createdAt) },
        {
            key: 'actions', header: <span className="sr-only">Acciones</span>, type: 'actions', width: '100px',
            render: (s) => s.isCurrent ? null : (
                <IconButton icon={LogOut} size="sm" tone="danger" tooltip="Cerrar sesión" label={`Cerrar sesión en ${s.device || 'navegador'}`} onClick={() => setPending({ kind: 'one', id: s.id })} />
            ),
        },
    ];

    return (
        <>
            {actionError ? <div className="profile-msg error" role="alert">{actionError}</div> : null}
            {failed ? (
                <LoadErrorState message="No pudimos cargar tus sesiones." onRetry={reload} />
            ) : (
                <DataTable<SessionRow>
                    ariaLabel="Sesiones y accesos recientes"
                    columns={columns}
                    rows={sessions}
                    rowKey={(s) => s.id}
                    loading={loading}
                    empty="Sin sesiones registradas"
                    minWidth="36rem"
                    defaultPageSize={10}
                />
            )}
            {sessions.length > 1 && (
                <div className="profile-form__footer">
                    <Button variant="danger" icon={LogOut} onClick={() => setPending({ kind: 'all' })}>Cerrar todas las demás sesiones</Button>
                </div>
            )}
            <ConfirmDialog
                isOpen={pending !== null}
                title="Confirmar acción"
                message={pending?.kind === 'all' ? '¿Cerrar todas las demás sesiones?' : '¿Cerrar esta sesión?'}
                tone="danger"
                loading={busy}
                onConfirm={() => void confirm()}
                onCancel={() => setPending(null)}
            />
        </>
    );
}

// ── Matriz de permisos ──
function PermissionsMatrix({ roleName, description, permissions }: {
    roleName: string;
    description?: string;
    permissions: RolePermissionRow[];
}) {
    // Sin permisos del servidor se muestran las capacidades estándar del rol.
    const rows: RolePermissionRow[] = permissions.length > 0
        ? permissions
        : (ROLE_CAPS[roleName] || ['Acceso básico']).map((cap, i) => ({ id: -(i + 1), name: cap }));
    const columns: Column<RolePermissionRow>[] = [
        { key: 'name', header: 'Permiso', width: '1.4fr' },
        { key: 'description', header: 'Descripción', width: '2fr', render: (p) => p.description || '—' },
        { key: 'state', header: 'Acceso', type: 'status', width: '8rem', render: () => <Badge tone="success" dot>Activo</Badge> },
    ];
    return (
        <>
            <p className="profile-note">{description || 'Este rol define tus acciones permitidas en el sistema.'}</p>
            <DataTable<RolePermissionRow>
                ariaLabel={`Permisos del rol ${roleName}`}
                columns={columns}
                rows={rows}
                rowKey={(p) => p.id}
                minWidth="34rem"
                defaultPageSize={10}
            />
        </>
    );
}

export function SecurityTab({ logout, passwordInfo, roleName, roleDescription, permissions }: {
    logout: () => void;
    passwordInfo: PasswordInfoState | null;
    roleName: string;
    roleDescription?: string;
    permissions: RolePermissionRow[];
}) {
    const [twoFactor, setTwoFactor] = useState<TwoFactorStatus>('loading');
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const loadSessions = useCallback(async () => {
        setFailed(false);
        try {
            const res = await authAPI.getSessions();
            setSessions(res.data.data || []);
        } catch {
            setFailed(true);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { void loadSessions(); }, [loadSessions]);

    return (
        <div className="profile-stack">
            <AccountHealth passwordInfo={passwordInfo} twoFactor={twoFactor} sessionCount={failed || loading ? null : sessions.length} />

            <section className="profile-section" aria-labelledby="profile-sec-password">
                <h2 id="profile-sec-password" className="profile-section__title"><Lock size={18} aria-hidden="true" /> Contraseña</h2>
                <PasswordSection logout={logout} />
            </section>

            <section className="profile-section" aria-labelledby="profile-sec-2fa">
                <h2 id="profile-sec-2fa" className="profile-section__title"><Smartphone size={18} aria-hidden="true" /> Autenticación de dos factores</h2>
                <TwoFactorSection onStatus={setTwoFactor} />
            </section>

            <section className="profile-section" aria-labelledby="profile-sec-sessions">
                <h2 id="profile-sec-sessions" className="profile-section__title"><Monitor size={18} aria-hidden="true" /> Sesiones y accesos recientes</h2>
                <p className="profile-note">Dispositivos donde tu cuenta está conectada. Puedes cerrar sesiones remotas.</p>
                <SessionsSection sessions={sessions} loading={loading} failed={failed} reload={() => void loadSessions()} />
            </section>

            <section className="profile-section" aria-labelledby="profile-sec-perms">
                <h2 id="profile-sec-perms" className="profile-section__title"><Shield size={18} aria-hidden="true" /> Capacidades del rol: {roleName}</h2>
                <PermissionsMatrix roleName={roleName} description={roleDescription} permissions={permissions} />
            </section>
        </div>
    );
}
