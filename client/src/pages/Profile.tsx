import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useLanguage } from '../hooks/useLanguage';
import { useCurrency } from '../hooks/useCurrency';
import { usersAPI, reportsAPI } from '../services/api';
import {
    Badge, Button, DataTable, EmptyState, Field, FormGrid, Input, LoadErrorState, PageContent, PageHeader, StatCard, Tabs,
    formatMoney, toneFor, type Column,
} from '@/ui';
import { TrendChart } from '@/ui/charts';
import {
    Save, Calendar, TrendingUp, ChevronRight, Fingerprint, MapPin, FileText, WalletCards,
    Building2, BadgeCheck, KeyRound, CircleUserRound, AlertCircle, CalendarClock,
    Briefcase as BriefcaseBusiness,
} from 'lucide-react';
import type { User as AppUser } from '../types';
import { workforceClient } from '../components/hr/workforceClient';
import { selectVacationBalance } from '../components/hr/vacationBalance';
import type { HrMyWorkforce } from '../types/hr-workforce';
import { formatHrNumber } from '../utils/hrFormat';
import { SecurityTab, type PasswordInfoState, type RolePermissionRow } from './profile/SecurityTab';
import { NotificationsTab, PreferencesTab } from './profile/PreferencesTab';
import { useUserPreferencesState } from './profile/usePreferencesState';
import { axiosErr, profileCompleteness, PROFILE_TABS, resolveProfileTab, type ProfileTab } from './profile/profileHelpers';
import './Profile.css';

interface ActivityEntry {
    id: number;
    description: string;
    date: string;
    amount: number;
    status: string;
}

interface PerformanceData {
    vsTeam: number;
    dailyData: Array<{ day: string; mySales: number; teamAvg: number }>;
    myWeekTotal?: number;
}

type FullProfileUser = AppUser & {
    role?: AppUser['role'] & { description?: string; permissions?: RolePermissionRow[] };
};

interface MyStats {
    salesToday: number;
    ordersToday: number;
    averageTicket: number;
    topProduct: string;
}

type SectionFailures = { stats: boolean; activity: boolean; performance: boolean; password: boolean };

function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function Profile() {
    const { symbol } = useCurrency();
    const money = (n: number) => formatMoney(n, symbol || 'C$');
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { language, setLanguage } = useLanguage();
    const [searchParams, setSearchParams] = useSearchParams();

    const activeTab = resolveProfileTab(searchParams.get('tab'));
    const [stats, setStats] = useState<MyStats | null>(null);
    const [fullUserData, setFullUserData] = useState<FullProfileUser | null>(null);
    const [activities, setActivities] = useState<ActivityEntry[]>([]);
    const [performance, setPerformance] = useState<PerformanceData | null>(null);
    const [passwordInfo, setPasswordInfo] = useState<PasswordInfoState | null>(null);
    const [failures, setFailures] = useState<SectionFailures>({ stats: false, activity: false, performance: false, password: false });
    const [myWorkforce, setMyWorkforce] = useState<HrMyWorkforce | null>(null);
    const [myHrLoading, setMyHrLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileLoadWarning, setProfileLoadWarning] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const prefsState = useUserPreferencesState(user?.id);

    const [formData, setFormData] = useState({
        name: user?.name || '', email: user?.email || '',
        nif: '', address: '', phone: '',
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (!user) return;
        (async () => {
            setProfileLoading(true);
            setProfileLoadWarning(null);
            try {
                const userRes = await usersAPI.getById(user.id);
                const full = userRes.data.data;
                setFullUserData(full);
                setFormData(prev => ({ ...prev, name: full.name || prev.name, email: full.email || prev.email, nif: full.nif || '', address: full.address || '', phone: full.phone || '' }));

                const [statsRes, actRes, perfRes, pwdRes] = await Promise.allSettled([
                    reportsAPI.getMyStats(),
                    reportsAPI.getMyActivity(10),
                    reportsAPI.getMyPerformance(),
                    reportsAPI.getMyPasswordInfo(),
                ]);
                if (statsRes.status === 'fulfilled') setStats(statsRes.value.data.data);
                if (actRes.status === 'fulfilled') setActivities(actRes.value.data.data);
                if (perfRes.status === 'fulfilled') setPerformance(perfRes.value.data.data);
                if (pwdRes.status === 'fulfilled') setPasswordInfo(pwdRes.value.data.data);
                setFailures({
                    stats: statsRes.status === 'rejected',
                    activity: actRes.status === 'rejected',
                    performance: perfRes.status === 'rejected',
                    password: pwdRes.status === 'rejected',
                });
                if ([statsRes, actRes, perfRes, pwdRes].some(result => result.status === 'rejected')) {
                    setProfileLoadWarning('Tu identidad está disponible, pero algunos datos secundarios no pudieron actualizarse.');
                }
            } catch {
                setProfileLoadWarning('No pudimos actualizar todos los datos del perfil. Se muestra la información disponible en tu sesión.');
            } finally {
                setProfileLoading(false);
            }
        })();
    }, [user, reloadKey]);

    useEffect(() => {
        if (user?.accountType !== 'INTERNAL' || !user.employeeId) {
            setMyWorkforce(null);
            return;
        }
        let active = true;
        setMyHrLoading(true);
        void workforceClient.getMyWorkforce({ limit: 30 })
            .then((data) => { if (active) setMyWorkforce(data); })
            .catch(() => { if (active) setMyWorkforce(null); })
            .finally(() => { if (active) setMyHrLoading(false); });
        return () => { active = false; };
    }, [user?.accountType, user?.employeeId]);

    const selectTab = (tab: ProfileTab) => {
        setSearchParams(tab === 'resumen' ? {} : { tab }, { replace: true });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setLoading(true);
        try {
            const res = await usersAPI.updateProfile(formData);
            const stored = JSON.parse(localStorage.getItem('user') || '{}');
            localStorage.setItem('user', JSON.stringify({ ...stored, ...res.data.data }));
            setMessage({ type: 'success', text: 'Perfil actualizado correctamente' });
            setTimeout(() => window.location.reload(), 1000);
        } catch (err: unknown) {
            setMessage({ type: 'error', text: axiosErr(err, 'Error al actualizar') });
        } finally { setLoading(false); }
    };

    const roleLower = (user?.role?.name || '').toLowerCase();
    const initials = getInitials(user?.name || 'U');
    const hasEmployeeContext = user?.accountType === 'INTERNAL' && Boolean(user.employeeId);
    const canManageEmployeeLinks = roleLower.includes('admin') || roleLower.includes('human') || roleLower.includes('rh');
    const vacationBalance = selectVacationBalance(myWorkforce?.vacationBalances);
    const myPendingRequests = myWorkforce
        ? [...myWorkforce.corrections, ...myWorkforce.overtimeRequests, ...myWorkforce.leaveRequests]
            .filter(item => item.status === 'DRAFT' || item.status === 'PENDING').length
        : null;
    const myApprovedOvertimeMinutes = myWorkforce?.overtimeRequests
        .filter(item => item.status === 'APPROVED')
        .reduce((total, item) => total + (item.approvedMinutes ?? 0), 0) ?? null;

    const roleNames = useMemo(() => {
        const names = (user?.roles ?? []).map(r => r.name);
        if (user?.role?.name && !names.includes(user.role.name)) names.unshift(user.role.name);
        return names;
    }, [user?.roles, user?.role?.name]);

    const branchOptions = useMemo(() => {
        const list: { id: number; name: string }[] = [];
        const add = (b?: { id: number; name: string } | null) => { if (b && !list.some(x => x.id === b.id)) list.push({ id: b.id, name: b.name }); };
        add(fullUserData?.branch ?? user?.branch);
        (fullUserData?.allowedBranches ?? user?.allowedBranches ?? []).forEach(ab => add(ab.branch));
        return list;
    }, [fullUserData, user]);

    const completeness = profileCompleteness(
        { name: formData.name, email: formData.email, nif: formData.nif, phone: formData.phone, address: formData.address },
        user?.accountType === 'INTERNAL' ? hasEmployeeContext : null,
    );

    const activityColumns: Column<ActivityEntry>[] = [
        { key: 'description', header: 'Descripción', width: '2fr' },
        { key: 'date', header: 'Fecha', render: (a) => new Date(a.date).toLocaleString('es-MX') },
        { key: 'amount', header: 'Monto', type: 'money', render: (a) => money(a.amount) },
        { key: 'status', header: 'Estado', type: 'status', render: (a) => <Badge tone={toneFor(String(a.status).toUpperCase())} dot>{a.status}</Badge> },
    ];

    const performanceBlock = (
        <section className="profile-section" aria-labelledby="profile-sec-perf">
            <h2 id="profile-sec-perf" className="profile-section__title"><TrendingUp size={18} aria-hidden="true" /> Mi rendimiento</h2>
            <div className="profile-kpis">
                <StatCard
                    label="Ventas de hoy"
                    value={stats ? money(stats.salesToday) : 'No disponible'}
                    context={stats
                        ? `${stats.ordersToday} ${stats.ordersToday === 1 ? 'orden' : 'órdenes'} · ticket promedio ${money(stats.averageTicket)}${stats.topProduct ? ` · top: ${stats.topProduct}` : ''}`
                        : failures.stats ? 'No pudimos consultar tus ventas de hoy.' : 'Consultando…'}
                />
                {performance ? (
                    <StatCard
                        label="Mi semana vs el equipo"
                        value={`${performance.vsTeam >= 0 ? '+' : ''}${formatHrNumber(performance.vsTeam)}%`}
                        tone={performance.vsTeam >= 0 ? 'success' : 'warning'}
                        context={`Total de la semana: ${(performance.myWeekTotal == null ? "N/D" : money(performance.myWeekTotal))} frente al promedio del equipo`}
                    />
                ) : null}
            </div>
            {performance && performance.dailyData.length > 0 ? (
                <TrendChart
                    ariaLabel="Mis ventas de los últimos 7 días frente al promedio del equipo"
                    buckets={performance.dailyData.map(d => d.day)}
                    current={performance.dailyData.map(d => d.mySales)}
                    previous={performance.dailyData.map(d => d.teamAvg)}
                    previousLabel="Promedio del equipo"
                    format={money}
                />
            ) : failures.performance ? (
                <LoadErrorState message="No pudimos consultar tu desempeño de la semana." onRetry={() => setReloadKey(k => k + 1)} />
            ) : null}
        </section>
    );

    const activityBlock = (
        <section className="profile-section" aria-labelledby="profile-sec-activity">
            <h2 id="profile-sec-activity" className="profile-section__title"><Calendar size={18} aria-hidden="true" /> Actividad reciente</h2>
            {failures.activity ? (
                <LoadErrorState message="No pudimos consultar tu actividad reciente." onRetry={() => setReloadKey(k => k + 1)} />
            ) : (
                <DataTable<ActivityEntry>
                    ariaLabel="Actividad reciente"
                    columns={activityColumns}
                    rows={activities}
                    rowKey={(a) => a.id}
                    loading={profileLoading && activities.length === 0}
                    empty="Sin actividad reciente"
                    minWidth="38rem"
                    defaultPageSize={10}
                />
            )}
        </section>
    );

    const dataBlock = (
        <section className="profile-section" aria-labelledby="profile-sec-data">
            <h2 id="profile-sec-data" className="profile-section__title"><CircleUserRound size={18} aria-hidden="true" /> Mis datos</h2>
            <form onSubmit={handleSubmit} className="profile-form" aria-label="Editar información">
                <FormGrid>
                    <Field label="Nombre completo" htmlFor="profile-name">
                        <Input id="profile-name" name="name" type="text" value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })} />
                    </Field>
                    <Field label="Correo electrónico" htmlFor="profile-email">
                        <Input id="profile-email" name="email" type="email" value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })} />
                    </Field>
                    <Field label="Cédula / NIF" htmlFor="profile-nif">
                        <Input id="profile-nif" name="nif" type="text" placeholder="001-010101-0001A"
                            value={formData.nif} onChange={e => setFormData({ ...formData, nif: e.target.value })} />
                    </Field>
                    <Field label="Teléfono" htmlFor="profile-phone">
                        <Input id="profile-phone" name="phone" type="tel" autoComplete="tel" placeholder="+505 0000 0000"
                            value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                    </Field>
                </FormGrid>
                <Field label="Dirección" htmlFor="profile-address">
                    <Input id="profile-address" name="address" type="text" autoComplete="street-address" placeholder="Calle, barrio, ciudad…"
                        value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                </Field>
                <div className="profile-form__footer">
                    <Button type="submit" variant="primary" icon={Save} loading={loading}>
                        {loading ? 'Guardando...' : 'Guardar Cambios'}
                    </Button>
                </div>
                {message && <div className={`profile-msg ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'} aria-live="polite">{message.text}</div>}
            </form>
        </section>
    );

    const hrBlock = (
        <section className="profile-section" aria-labelledby="profile-sec-hr">
            <h2 id="profile-sec-hr" className="profile-section__title"><BriefcaseBusiness size={18} aria-hidden="true" /> Mi RH</h2>
            {!hasEmployeeContext ? (
                <div className="profile-hr-unlinked">
                    <p className="profile-hr-kicker">Mi expediente laboral</p>
                    <h3>Esta cuenta todavía no está vinculada a un empleado</h3>
                    <p>Por eso no podemos mostrar horario, marcajes, horas extra, vacaciones, préstamos ni colillas personales. No significa que el módulo esté vacío: falta relacionar este usuario con su expediente en Personal.</p>
                    <dl className="profile-hr-link-status">
                        <div><dt>Tipo de cuenta</dt><dd>{user?.accountType === 'INTERNAL' ? 'Interna, pendiente de vínculo' : 'Externa'}</dd></div>
                        <div><dt>Expediente</dt><dd>No vinculado</dd></div>
                    </dl>
                    {canManageEmployeeLinks ? (
                        <Link to="/rh/personal" className="profile-hr-main-link">Vincular en Personal <ChevronRight size={17} aria-hidden="true" /></Link>
                    ) : (
                        <p className="profile-hr-help">Solicita a Recursos Humanos que vincule tu usuario con tu expediente laboral.</p>
                    )}
                </div>
            ) : (
                <>
                    <div className="profile-hr-hero">
                        <p>Consulta tu jornada, registra marcajes y gestiona solicitudes, pagos y beneficios desde un solo lugar.</p>
                        <Link to="/rh/marcaje" className="profile-hr-main-link"><MapPin size={17} aria-hidden="true" /> Ir a marcaje <ChevronRight size={17} aria-hidden="true" /></Link>
                    </div>
                    <dl className="profile-hr-identity">
                        <div><dt>Empleado</dt><dd>{user?.employee?.employeeCode ?? user?.employee?.employeeNumber ?? `#${user?.employeeId}`}</dd></div>
                        <div className="profile-hr-vacation-balance"><dt>Saldo de vacaciones</dt><dd>{myHrLoading ? 'Cargando…' : vacationBalance ? `${formatHrNumber(vacationBalance.available)} ${vacationBalance.unit.toLowerCase()}` : 'Sin saldo disponible'}</dd></div>
                        <div><dt>Solicitudes en espera</dt><dd>{myHrLoading ? '…' : myPendingRequests ?? 'No disponible'}</dd></div>
                        <div><dt>Horas extra aprobadas</dt><dd>{myHrLoading ? '…' : myApprovedOvertimeMinutes != null ? `${formatHrNumber(myApprovedOvertimeMinutes)} min` : 'No disponible'}</dd></div>
                        <div><dt>Estado laboral</dt><dd>{user?.employee?.status ?? 'Vinculado'}</dd></div>
                        <div><dt>Sucursal</dt><dd>{fullUserData?.branch?.name || user?.branch?.name || 'Sin asignar'}</dd></div>
                    </dl>
                    <h3 className="profile-hr-heading">Accesos de Mi RH</h3>
                    <p className="profile-note">Abre cada sección para consultar datos emitidos por el servidor o iniciar una gestión.</p>
                    <div className="profile-hr-grid">
                        <Link to="/rh/mi-portal/horario"><CalendarClock size={22} aria-hidden="true" /><span><strong>Mi horario</strong><small>Turnos publicados y acuse de lectura</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/marcaje"><MapPin size={22} aria-hidden="true" /><span><strong>Marcajes</strong><small>Entrada, descansos y salida</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/mi-portal/gestion?tab=OVERTIME"><TrendingUp size={22} aria-hidden="true" /><span><strong>Horas extra</strong><small>Solicitadas, aprobadas y rechazadas</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/mi-portal/gestion?tab=LEAVE"><Calendar size={22} aria-hidden="true" /><span><strong>Vacaciones y permisos</strong><small>Crea solicitudes y revisa sus estados</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/mi-portal/nomina"><FileText size={22} aria-hidden="true" /><span><strong>Recibos de pago</strong><small>Ingresos, deducciones y colillas</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/mi-portal/prestaciones"><WalletCards size={22} aria-hidden="true" /><span><strong>Beneficios</strong><small>Viáticos, préstamos y deducciones</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                        <Link to="/rh/biometria"><Fingerprint size={22} aria-hidden="true" /><span><strong>Mi biometría</strong><small>Consentimiento, enrolamiento y revocación</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                    </div>
                </>
            )}
        </section>
    );

    if (!user) {
        return <EmptyState title="Sesión no disponible" description="Inicia sesión para ver tu perfil." />;
    }

    return (
        <PageContent maxWidth={1100}>
            <div className="profile-page">
                <PageHeader title="Mi perfil" description="Tu identidad, seguridad y preferencias en un solo lugar." />
                <header className="profile-overview" aria-labelledby="profile-overview-title">
                    <div className={`profile-avatar role-${roleLower}`} aria-hidden="true">{initials}</div>
                    <div className="profile-overview-identity">
                        <span className="profile-eyebrow"><CircleUserRound size={14} aria-hidden="true" /> Centro de cuenta</span>
                        <div className="profile-name-row">
                            <h2 id="profile-overview-title" className="profile-user-name">{user?.name}</h2>
                            {(roleNames.length > 0 ? roleNames : ['Sin rol']).map(name => (
                                <span key={name} className="profile-role-badge"><BadgeCheck size={14} aria-hidden="true" /> {name}</span>
                            ))}
                        </div>
                        <p className="profile-user-email">{user?.email || 'Correo no disponible'} · @{user?.username}</p>
                        <div className="profile-overview-status">
                            <span><Building2 size={15} aria-hidden="true" /> {fullUserData?.company?.name || user?.company?.name || 'Empresa no disponible'}</span>
                            <span><MapPin size={15} aria-hidden="true" /> {branchOptions.length > 0 ? branchOptions.map(b => b.name).join(', ') : 'Sin sucursal asignada'}</span>
                            <span className={hasEmployeeContext ? 'linked' : 'pending'}><BriefcaseBusiness size={15} aria-hidden="true" /> {hasEmployeeContext ? 'Expediente laboral vinculado' : 'Sin expediente laboral vinculado'}</span>
                        </div>
                        <div className="profile-completeness">
                            <div className="profile-completeness__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness.pct} aria-label="Completitud del perfil">
                                <span style={{ width: `${completeness.pct}%` }} />
                            </div>
                            <small>
                                Perfil completo al {completeness.pct}%
                                {completeness.missing.length > 0 ? ` · falta: ${completeness.missing.join(', ')}` : ''}
                            </small>
                        </div>
                    </div>
                    <div className="profile-overview-security">
                        <KeyRound size={20} aria-hidden="true" />
                        <div><strong>Seguridad de la cuenta</strong><small>Contraseña, sesiones y verificación en dos pasos</small></div>
                        <Button variant="secondary" size="sm" onClick={() => selectTab('seguridad')}>Revisar <ChevronRight size={16} aria-hidden="true" /></Button>
                    </div>
                    <dl className="profile-overview-facts">
                        <div><dt>Tipo de cuenta</dt><dd>{user?.accountType === 'INTERNAL' ? 'Interna' : user?.accountType === 'EXTERNAL' ? 'Externa' : 'No definido'}</dd></div>
                        <div><dt>Estado</dt><dd>{user?.status || 'No disponible'}</dd></div>
                        <div><dt>Miembro desde</dt><dd>{profileLoading ? 'Actualizando…' : fullUserData?.createdAt ? new Date(fullUserData.createdAt).toLocaleDateString('es-NI', { month: 'short', year: 'numeric' }) : 'No disponible'}</dd></div>
                        <div><dt>Empleado</dt><dd>{hasEmployeeContext ? user?.employee?.employeeCode ?? user?.employee?.employeeNumber ?? `#${user?.employeeId}` : 'No vinculado'}</dd></div>
                    </dl>
                </header>

                {profileLoadWarning && (
                    <div className="profile-load-warning" role="status">
                        <AlertCircle size={18} aria-hidden="true" /><span>{profileLoadWarning}</span>
                        <Button variant="ghost" size="sm" onClick={() => setReloadKey(k => k + 1)}>Reintentar</Button>
                    </div>
                )}

                <Tabs
                    ariaLabel="Secciones de mi perfil"
                    active={activeTab}
                    onChange={(id) => selectTab(id as ProfileTab)}
                    tabs={PROFILE_TABS}
                />

                <div className="profile-panel" id="profile-active-panel" role="tabpanel" aria-label={PROFILE_TABS.find(t => t.id === activeTab)?.label}>
                    {activeTab === 'resumen' && (
                        <div className="profile-stack">
                            {performanceBlock}
                            {activityBlock}
                            {hrBlock}
                            {dataBlock}
                        </div>
                    )}
                    {activeTab === 'seguridad' && (
                        <SecurityTab
                            logout={logout}
                            passwordInfo={failures.password ? null : passwordInfo}
                            roleName={user?.role?.name ?? ''}
                            roleDescription={fullUserData?.role?.description}
                            permissions={fullUserData?.role?.permissions ?? []}
                        />
                    )}
                    {activeTab === 'preferencias' && (
                        <PreferencesTab
                            state={prefsState}
                            language={language}
                            setLanguage={setLanguage}
                            theme={theme}
                            toggleTheme={toggleTheme}
                            branches={branchOptions}
                        />
                    )}
                    {activeTab === 'notificaciones' && <NotificationsTab state={prefsState} />}
                </div>
            </div>
        </PageContent>
    );
}
