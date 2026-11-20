import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useTheme } from '../hooks/useTheme';
import { useLanguage } from '../hooks/useLanguage';
import { useCurrency } from '../hooks/useCurrency';
import { usersAPI, reportsAPI, authAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Button from '../components/Button';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import {
    User, Lock, Save, Eye, EyeOff, Check, X, ShieldCheck,
    Calendar, TrendingUp, Shield, Smartphone, Monitor, LogOut,
    ShoppingBag, CreditCard, Star, Languages,
    Moon, Sun, Bell, Settings,
    Briefcase as BriefcaseBusiness, CalendarClock, ChevronRight, Fingerprint, MapPin, FileText, WalletCards,
    Building2, BadgeCheck, KeyRound, CircleUserRound, AlertCircle, Mail,
    type LucideIcon
} from 'lucide-react';
import type { User as AppUser } from '../types';
import type { Language } from '../utils/translations';
import { workforceClient } from '../components/hr/workforceClient';
import { selectVacationBalance } from '../components/hr/vacationBalance';
import type { HrMyWorkforce } from '../types/hr-workforce';
import { formatHrNumber } from '../utils/hrFormat';
import { HrPage, HrSection, type HrFact } from '../components/hr/layout/HrWorkspace';
import './Profile.css';

function axiosErr(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

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

interface PasswordInfoState {
    passwordChangedAt?: string | null;
    daysUntilExpiry: number | null;
    expiryDays: number;
}

interface RolePermissionRow {
    id: number;
    name: string;
    description?: string;
}

type FullProfileUser = AppUser & {
    role?: AppUser['role'] & { description?: string; permissions?: RolePermissionRow[] };
};

interface SessionRow {
    id: string;
    device?: string;
    isCurrent?: boolean;
    ipAddress?: string;
    createdAt: string;
}

type ProfileTab = 'info' | 'hr' | 'stats' | 'permissions' | 'settings' | 'security' | 'sessions' | '2fa';

interface MyStats {
    salesToday: number;
    ordersToday: number;
    averageTicket: number;
    topProduct: string;
}

const PWD_RULES = [
    { id: 'len', label: 'Mínimo 8 caracteres', test: (p: string) => p.length >= 8 },
    { id: 'up', label: 'Una mayúscula', test: (p: string) => /[A-Z]/.test(p) },
    { id: 'low', label: 'Una minúscula', test: (p: string) => /[a-z]/.test(p) },
    { id: 'num', label: 'Un número', test: (p: string) => /\d/.test(p) },
    { id: 'sym', label: 'Un símbolo (!@#$%...)', test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function Profile() {
    const { formatMoney } = useCurrency();
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { language, setLanguage } = useLanguage();
    const [searchParams, setSearchParams] = useSearchParams();

    const requestedTab = searchParams.get('tab');
    const [activeTab, setActiveTab] = useState<ProfileTab>(() =>
        requestedTab === 'hr' || (user?.accountType === 'INTERNAL' && Boolean(user.employeeId)) ? 'hr' : 'info'
    );
    const [stats, setStats] = useState<MyStats | null>(null);
    const [fullUserData, setFullUserData] = useState<FullProfileUser | null>(null);
    const [activities, setActivities] = useState<ActivityEntry[]>([]);
    const [performance, setPerformance] = useState<PerformanceData | null>(null);
    const [passwordInfo, setPasswordInfo] = useState<PasswordInfoState | null>(null);
    const [myWorkforce, setMyWorkforce] = useState<HrMyWorkforce | null>(null);
    const [myHrLoading, setMyHrLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileLoadWarning, setProfileLoadWarning] = useState<string | null>(null);

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
                if ([statsRes, actRes, perfRes, pwdRes].some(result => result.status === 'rejected')) {
                    setProfileLoadWarning('Tu identidad está disponible, pero algunos datos secundarios no pudieron actualizarse.');
                }
            } catch {
                setProfileLoadWarning('No pudimos actualizar todos los datos del perfil. Se muestra la información disponible en tu sesión.');
            } finally {
                setProfileLoading(false);
            }
        })();
    }, [user]);

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

    useEffect(() => {
        if (requestedTab && ['info', 'hr', 'stats', 'permissions', 'settings', 'security', 'sessions', '2fa'].includes(requestedTab)) {
            setActiveTab(requestedTab as ProfileTab);
        }
    }, [requestedTab]);

    const selectTab = (tab: ProfileTab) => {
        setActiveTab(tab);
        setSearchParams(tab === 'info' ? {} : { tab }, { replace: true });
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

    const tabs: { id: ProfileTab; icon: LucideIcon; label: string }[] = [
        { id: 'info', icon: User, label: 'Información' },
        { id: 'hr', icon: BriefcaseBusiness, label: 'Mi RH' },
        { id: 'stats', icon: TrendingUp, label: 'Mi Desempeño' },
        { id: 'permissions', icon: Shield, label: 'Permisos' },
        { id: 'settings', icon: Settings, label: 'Preferencias' },
        { id: 'security', icon: Lock, label: 'Contraseña' },
        { id: 'sessions', icon: Monitor, label: 'Sesiones' },
        { id: '2fa', icon: Smartphone, label: '2FA' },
    ];

    const accountTypeLabel = user?.accountType === 'INTERNAL' ? 'Interna' : user?.accountType === 'EXTERNAL' ? 'Externa' : 'No definido';
    const memberSince = profileLoading ? 'Actualizando…' : fullUserData?.createdAt ? new Date(fullUserData.createdAt).toLocaleDateString('es-NI', { month: 'short', year: 'numeric' }) : 'No disponible';
    const employeeLabel = user?.employee?.employeeCode ?? user?.employee?.employeeNumber ?? `#${user?.employeeId}`;
    const branchName = fullUserData?.branch?.name || user?.branch?.name;
    const heroFacts: HrFact[] = [
        { label: 'Tipo de cuenta', value: accountTypeLabel },
        { label: 'Estado', value: user?.status || 'No disponible' },
        { label: 'Miembro desde', value: memberSince },
        { label: 'Empleado', value: hasEmployeeContext ? employeeLabel : 'No vinculado', tone: hasEmployeeContext ? 'success' : 'default' },
    ];
    const ProfileAvatar = useMemo(() => {
        function ProfileAvatarInitials() {
            return <span className={`profile-avatar role-${roleLower}`}>{initials}</span>;
        }
        return ProfileAvatarInitials;
    }, [initials, roleLower]);

    const tabGroups: { label: string; ids: ProfileTab[] }[] = [
        { label: 'Cuenta', ids: ['info', 'settings'] },
        { label: 'Trabajo', ids: ['hr', 'stats', 'permissions'] },
        { label: 'Seguridad', ids: ['security', 'sessions', '2fa'] },
    ];
    const TAB_HELP: Record<ProfileTab, string> = {
        info: 'Datos personales y de contacto que ve tu equipo.',
        hr: 'Tu expediente laboral, marcajes, saldos y solicitudes.',
        stats: 'Ventas y actividad registradas con tu usuario.',
        permissions: 'Lo que tu rol te permite hacer en el sistema.',
        settings: 'Idioma, moneda y tema de la interfaz.',
        security: 'Cambia tu contraseña y revisa su vigencia.',
        sessions: 'Dispositivos con sesión abierta en tu cuenta.',
        '2fa': 'Agrega un segundo paso al iniciar sesión.',
    };
    const activeTabMeta = tabs.find(t => t.id === activeTab) ?? tabs[0];
    const ActiveTabIcon = activeTabMeta.icon;

    return (
        <HrPage className="profile-page profile-v3">
            {profileLoadWarning && <div className="profile-load-warning" role="status"><AlertCircle size={18} aria-hidden="true" /><span>{profileLoadWarning}</span></div>}

            <div className="profile-shell">
                <aside className="profile-identity" aria-labelledby="profile-overview-title">
                    <section className="profile-id-card">
                        <div className="profile-id-head">
                            <ProfileAvatar />
                            <div className="profile-id-name">
                                <h1 id="profile-overview-title"><span className="sr-only">Mi perfil: </span>{user?.name}</h1>
                                <p className="profile-user-email">@{user?.username} · <span className="profile-id-role"><BadgeCheck size={13} aria-hidden="true" /> {user?.role?.name ?? 'Sin rol'}</span></p>
                            </div>
                        </div>
                        <p className={`profile-id-link ${hasEmployeeContext ? 'is-linked' : 'is-pending'}`}><BriefcaseBusiness size={14} aria-hidden="true" /> {hasEmployeeContext ? 'Expediente laboral vinculado' : 'Sin expediente laboral vinculado'}</p>
                        <ul className="profile-id-meta">
                            <li><Building2 size={15} aria-hidden="true" /><span>{fullUserData?.company?.name || user?.company?.name || 'Empresa no disponible'}</span></li>
                            <li><MapPin size={15} aria-hidden="true" /><span>{branchName || 'Sin sucursal asignada'}</span></li>
                            <li><Mail size={15} aria-hidden="true" /><span>{user?.email || 'Correo no disponible'}</span></li>
                        </ul>
                        <dl className="profile-id-facts">
                            {heroFacts.map(fact => (
                                <div key={fact.label} className={fact.tone === 'success' ? 'is-success' : undefined}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                            ))}
                        </dl>
                    </section>

                    <nav className="profile-nav" aria-label="Secciones de mi perfil">
                        {tabGroups.map(group => (
                            <div key={group.label} className="profile-nav-group">
                                <span className="profile-nav-label">{group.label}</span>
                                {group.ids.map(id => {
                                    const tab = tabs.find(t => t.id === id);
                                    if (!tab) return null;
                                    const Icon = tab.icon;
                                    return (
                                        <button key={id} type="button" id={`profile-tab-${id}`} aria-controls={`profile-panel-${id}`} aria-current={activeTab === id ? 'page' : undefined} className={activeTab === id ? 'active' : undefined} onClick={() => selectTab(id)}>
                                            <Icon size={17} aria-hidden="true" /><span>{tab.label}</span><ChevronRight size={15} aria-hidden="true" className="profile-nav-caret" />
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </nav>

                    <div className="profile-security-card">
                        <span className="profile-security-icon" aria-hidden="true"><KeyRound size={20} /></span>
                        <div><strong>Seguridad de la cuenta</strong><small>{passwordInfo?.daysUntilExpiry != null ? `Tu contraseña vence en ${passwordInfo.daysUntilExpiry} día(s)` : 'Contraseña, sesiones y verificación en dos pasos'}</small></div>
                        <button type="button" onClick={() => selectTab('security')}>Revisar <ChevronRight size={16} aria-hidden="true" /></button>
                    </div>
                </aside>

                <div className="profile-content">
                    <header className="profile-content-head">
                        <span className="profile-content-icon" aria-hidden="true"><ActiveTabIcon size={22} /></span>
                        <div>
                            <span className="profile-eyebrow"><CircleUserRound size={13} aria-hidden="true" /> Centro de cuenta</span>
                            <h2 id={`profile-heading-${activeTab}`}>{activeTabMeta.label}</h2>
                            <p>{TAB_HELP[activeTab]}</p>
                        </div>
                    </header>

                <div
                    className="profile-panel"
                    id={`profile-panel-${activeTab}`}
                    role="region"
                    aria-labelledby={`profile-heading-${activeTab}`}
                >

                    {/* INFO */}
                    {activeTab === 'info' && (
                        <HrSection
                            className="profile-tab-fade"
                            eyebrow="Datos personales"
                            title={<><User size={18} aria-hidden="true" /> Editar Información</>}
                            description="Tu nombre, correo y datos de contacto visibles para la empresa."
                        >
                            <form onSubmit={handleSubmit} className="profile-edit-form">
                                <div className="profile-form-row">
                                    <div className="profile-field">
                                        <label htmlFor="profile-name">Nombre completo</label>
                                        <input id="profile-name" name="name" type="text" className="profile-input" value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div className="profile-field">
                                        <label htmlFor="profile-email">Correo electrónico</label>
                                        <input id="profile-email" name="email" type="email" className="profile-input" value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                    </div>
                                </div>
                                <div className="profile-form-row">
                                    <div className="profile-field">
                                        <label htmlFor="profile-nif">Cédula / NIF</label>
                                        <input id="profile-nif" name="nif" type="text" className="profile-input" placeholder="001-010101-0001A"
                                            value={formData.nif} onChange={e => setFormData({ ...formData, nif: e.target.value })} />
                                    </div>
                                    <div className="profile-field">
                                        <label htmlFor="profile-phone">Teléfono</label>
                                        <input id="profile-phone" name="phone" type="tel" autoComplete="tel" className="profile-input" placeholder="+505 0000 0000"
                                            value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                    </div>
                                </div>
                                <div className="profile-field">
                                    <label htmlFor="profile-address">Dirección</label>
                                    <input id="profile-address" name="address" type="text" autoComplete="street-address" className="profile-input" placeholder="Calle, barrio, ciudad…"
                                        value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                                </div>
                                {message && <div className={`profile-msg ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'} aria-live="polite">{message.text}</div>}
                                <div className="profile-form-footer">
                                    <Button type="submit" disabled={loading} variant="primary">
                                        <Save size={18} /> {loading ? 'Guardando...' : 'Guardar Cambios'}
                                    </Button>
                                </div>
                            </form>
                        </HrSection>
                    )}

                    {/* EMPLOYEE SELF-SERVICE */}
                    {activeTab === 'hr' && (
                        <div className="profile-tab-fade profile-stack">
                            {!hasEmployeeContext ? (
                                <HrSection
                                    className="profile-hr-unlinked"
                                    eyebrow="Mi expediente laboral"
                                    aria-labelledby="profile-hr-unlinked-title"
                                >
                                    <div className="profile-hr-unlinked-body">
                                        <span className="profile-hr-unlinked-icon"><BriefcaseBusiness size={26} aria-hidden="true" /></span>
                                        <div>
                                            <h3 id="profile-hr-unlinked-title">Esta cuenta todavía no está vinculada a un empleado</h3>
                                            <p>Por eso no podemos mostrar horario, marcajes, horas extra, vacaciones, préstamos ni colillas personales. No significa que el módulo esté vacío: falta relacionar este usuario con su expediente en Personal.</p>
                                            <dl className="profile-kv-grid is-two">
                                                <div><dt>Tipo de cuenta</dt><dd>{user?.accountType === 'INTERNAL' ? 'Interna, pendiente de vínculo' : 'Externa'}</dd></div>
                                                <div><dt>Expediente</dt><dd>No vinculado</dd></div>
                                            </dl>
                                            {canManageEmployeeLinks ? (
                                                <Link to="/rh/personal" className="profile-hr-main-link">Vincular en Personal <ChevronRight size={17} aria-hidden="true" /></Link>
                                            ) : (
                                                <p className="profile-hr-help">Solicita a Recursos Humanos que vincule tu usuario con tu expediente laboral.</p>
                                            )}
                                        </div>
                                    </div>
                                </HrSection>
                            ) : <>
                            <HrSection
                                eyebrow="EXPEDIENTE PERSONAL"
                                title={<><BriefcaseBusiness size={18} aria-hidden="true" /> Mi información laboral</>}
                                description="Consulta tu jornada, registra marcajes y gestiona solicitudes, pagos y beneficios desde un solo lugar."
                                actions={<Link to="/rh/marcaje" className="profile-hr-main-link is-solid"><MapPin size={17} aria-hidden="true" /> Ir a marcaje <ChevronRight size={17} aria-hidden="true" /></Link>}
                            >
                                <dl className="hr-console-signals profile-hr-signals">
                                    <div><dt>Empleado</dt><dd>{employeeLabel}</dd></div>
                                    <div className="is-success"><dt>Saldo de vacaciones</dt><dd>{myHrLoading ? 'Cargando…' : vacationBalance ? `${formatHrNumber(vacationBalance.available)} ${vacationBalance.unit.toLowerCase()}` : 'Sin saldo disponible'}</dd></div>
                                    <div><dt>Solicitudes en espera</dt><dd>{myHrLoading ? '…' : myPendingRequests ?? '—'}</dd></div>
                                    <div><dt>Horas extra aprobadas</dt><dd>{myHrLoading ? '…' : myApprovedOvertimeMinutes != null ? `${formatHrNumber(myApprovedOvertimeMinutes)} min` : '—'}</dd></div>
                                </dl>
                                <div className="profile-hr-context">
                                    <span><strong>{user?.employee?.status ?? 'Vinculado'}</strong> Estado laboral</span>
                                    <span><strong>{branchName || 'Sin asignar'}</strong> Sucursal</span>
                                </div>
                            </HrSection>
                            <HrSection
                                title="Accesos de Mi RH"
                                description="Abre cada sección para consultar datos emitidos por el servidor o iniciar una gestión."
                            >
                                <div className="profile-hr-grid">
                                    <div className="hr-ws-grid">
                                        <Link className="hr-ws-tile" to="/rh/mi-portal/horario"><CalendarClock size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Horarios del equipo</strong><small>Turnos publicados de tu sucursal y acuse personal</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/marcaje"><MapPin size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Marcajes</strong><small>Entrada, descansos y salida</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/mi-portal/gestion?tab=OVERTIME"><TrendingUp size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Horas extra</strong><small>Solicitadas, aprobadas y rechazadas</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/mi-portal/gestion?tab=LEAVE"><Calendar size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Vacaciones y permisos</strong><small>Crea solicitudes y revisa sus estados</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/mi-portal/nomina"><FileText size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Recibos de pago</strong><small>Ingresos, deducciones y colillas</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/mi-portal/prestaciones"><WalletCards size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Beneficios</strong><small>Viáticos, préstamos y deducciones</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                        <Link className="hr-ws-tile" to="/rh/biometria"><Fingerprint size={20} aria-hidden="true" /><span className="profile-tile-body"><strong>Mi biometría</strong><small>Consentimiento, enrolamiento y revocación</small></span><ChevronRight size={17} aria-hidden="true" /></Link>
                                    </div>
                                </div>
                            </HrSection>
                            </>}
                        </div>
                    )}

                    {/* STATS */}
                    {activeTab === 'stats' && (
                        <div className="profile-tab-fade profile-stack">
                            <HrSection title={<><TrendingUp size={18} aria-hidden="true" /> Mi Rendimiento</>}>
                                <div className="stats-cards-grid">
                                    <div className="stat-card-mini">
                                        <div className="stat-icon sales"><CreditCard size={20} /></div>
                                        <div><div className="stat-label">Ventas Hoy</div><div className="stat-value">{formatMoney(stats?.salesToday || 0)}</div></div>
                                    </div>
                                    <div className="stat-card-mini">
                                        <div className="stat-icon orders"><ShoppingBag size={20} /></div>
                                        <div><div className="stat-label">Órdenes Hoy</div><div className="stat-value">{stats?.ordersToday || 0}</div></div>
                                    </div>
                                    <div className="stat-card-mini">
                                        <div className="stat-icon ticket"><TrendingUp size={20} /></div>
                                        <div><div className="stat-label">Ticket Prom.</div><div className="stat-value">{formatMoney(stats?.averageTicket || 0)}</div></div>
                                    </div>
                                    <div className="stat-card-mini">
                                        <div className="stat-icon product"><Star size={20} /></div>
                                        <div><div className="stat-label">Producto Top</div><div className="stat-value">{stats?.topProduct || '—'}</div></div>
                                    </div>
                                </div>
                            </HrSection>

                            {performance && (
                                <HrSection
                                    title="Ventas Últimos 7 Días"
                                    actions={
                                        <div className={`perf-vs-badge ${performance.vsTeam >= 0 ? 'positive' : 'negative'}`}>
                                            {performance.vsTeam >= 0 ? '+' : ''}{performance.vsTeam}% vs promedio del equipo
                                        </div>
                                    }
                                >
                                    <div className="perf-chart">
                                        <ResponsiveContainer>
                                            <BarChart data={performance.dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                                <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }} />
                                                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} tickFormatter={v => `$${v}`} />
                                                <Tooltip
                                                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                                                    formatter={(value: number | string, name: string) => [`$${Number(value).toFixed(0)}`, name === 'mySales' ? 'Mis Ventas' : 'Promedio Equipo']}
                                                />
                                                <Legend formatter={(v) => v === 'mySales' ? 'Mis Ventas' : 'Promedio Equipo'} />
                                                <Bar dataKey="mySales" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="teamAvg" fill="#334155" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="perf-week-total">
                                        Total semana: <strong>{formatMoney(performance.myWeekTotal || 0)}</strong>
                                    </div>
                                </HrSection>
                            )}

                            <HrSection title="Actividad Reciente" count={activities.length}>
                                <div className="activity-timeline">
                                    {activities.length > 0 ? activities.map(act => (
                                        <div key={act.id} className="activity-item">
                                            <div className="activity-dot"></div>
                                            <div className="activity-content">
                                                <div>
                                                    <div className="act-desc">{act.description}</div>
                                                    <div className="activity-meta">{new Date(act.date).toLocaleString('es-MX')}</div>
                                                </div>
                                                <div className="act-right">
                                                    <span className="act-amount">{formatMoney(act.amount)}</span>
                                                    <span className={`act-status ${act.status.toLowerCase()}`}>{act.status}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="profile-empty">
                                            <Calendar size={40} aria-hidden="true" /><p>Sin actividad reciente</p>
                                        </div>
                                    )}
                                </div>
                            </HrSection>
                        </div>
                    )}

                    {/* PERMISSIONS */}
                    {activeTab === 'permissions' && (
                        <HrSection
                            className="profile-tab-fade"
                            title={<><Shield size={18} aria-hidden="true" /> Capacidades del Rol: {user?.role?.name ?? ''}</>}
                            description={fullUserData?.role?.description || 'Este rol define tus acciones permitidas en el sistema.'}
                        >
                            <div className="permissions-list">
                                {(() => {
                                    // Use DB permissions if available, otherwise show role capabilities
                                    const dbPerms = fullUserData?.role?.permissions || [];
                                    if (dbPerms.length > 0) {
                                        return dbPerms.map((p: RolePermissionRow) => (
                                            <div key={p.id} className="permission-item">
                                                <div className="p-badge">ACTIVO</div>
                                                <div className="p-text"><strong>{p.name}</strong><span>{p.description}</span></div>
                                            </div>
                                        ));
                                    }
                                    // Static capabilities by role
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
                                    const caps = ROLE_CAPS[user?.role?.name || ''] || ['Acceso básico'];
                                    return caps.map((cap, i) => (
                                        <div key={i} className="permission-item">
                                            <div className="p-badge">ACTIVO</div>
                                            <div className="p-text"><strong>{cap}</strong></div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </HrSection>
                    )}

                    {/* PREFERENCES */}
                    {activeTab === 'settings' && (
                        <HrSection
                            className="profile-tab-fade"
                            title={<><Settings size={18} aria-hidden="true" /> Preferencias</>}
                        >
                            <div className="preferences-list">
                                <div className="preference-box">
                                    <div className="pref-info">
                                        <span className="pref-icon" aria-hidden="true"><Languages size={18} /></span>
                                        <div><h4>Idioma</h4><p>Idioma de la interfaz</p></div>
                                    </div>
                                    <Select
                                        className="profile-select"
                                        value={{ value: language, label: language === 'es' ? 'Español' : 'English' }}
                                        onChange={(option: SingleValue<{ value: Language; label: string }>) =>
                                            option && setLanguage(option.value)}
                                        options={[
                                            { value: 'es' as Language, label: 'Español' },
                                            { value: 'en' as Language, label: 'English' }
                                        ]}
                                        isSearchable={false}
                                    />
                                </div>
                                <div className="preference-box">
                                    <div className="pref-info">
                                        <span className="pref-icon" aria-hidden="true">{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}</span>
                                        <div><h4>Tema</h4><p>Modo {theme === 'dark' ? 'oscuro' : 'claro'} activo</p></div>
                                    </div>
                                    <Button variant="ghost" onClick={toggleTheme}>
                                        {theme === 'dark' ? 'Cambiar a Claro' : 'Cambiar a Oscuro'}
                                    </Button>
                                </div>
                                <div className="preference-box">
                                    <div className="pref-info">
                                        <span className="pref-icon" aria-hidden="true"><Bell size={18} /></span>
                                        <div><h4>Notificaciones</h4><p>Alertas en tiempo real</p></div>
                                    </div>
                                    <label className="switch"><span className="sr-only">Activar notificaciones en tiempo real</span><input type="checkbox" defaultChecked aria-label="Activar notificaciones en tiempo real" /><span className="slider round"></span></label>
                                </div>
                            </div>
                        </HrSection>
                    )}

                    {/* SECURITY */}
                    {activeTab === 'security' && <SecuritySection logout={logout} passwordInfo={passwordInfo} />}

                    {/* SESSIONS */}
                    {activeTab === 'sessions' && <SessionsSection />}

                    {/* 2FA */}
                    {activeTab === '2fa' && <TwoFactorSection />}

                </div>
                </div>
            </div>
        </HrPage>
    );
}

/** Security section as separate component to isolate its state */
function SecuritySection({ logout, passwordInfo }: { logout: () => void; passwordInfo: PasswordInfoState | null }) {
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
            <HrSection className="profile-tab-fade">
                <div className="profile-result" role="status">
                    <ShieldCheck size={52} aria-hidden="true" />
                    <h3>Contraseña actualizada</h3>
                    <p>Serás redirigido al inicio de sesión...</p>
                </div>
            </HrSection>
        );
    }

    return (
        <div className="profile-tab-fade profile-stack">
            {passwordInfo && (
                <HrSection title={<><Lock size={18} aria-hidden="true" /> Seguridad</>}>
                    <div className="pwd-info-card">
                        <div className="pwd-info-row">
                            <span className="pwd-info-label">Último cambio</span>
                            <span className="pwd-info-value">
                                {passwordInfo.passwordChangedAt
                                    ? new Date(passwordInfo.passwordChangedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
                                    : 'Nunca'}
                            </span>
                        </div>
                        {passwordInfo.daysUntilExpiry !== null && (
                            <>
                                <div className="pwd-info-row">
                                    <span className="pwd-info-label">Expira en</span>
                                    <span className={`pwd-info-value ${passwordInfo.daysUntilExpiry <= 15 ? 'danger' : passwordInfo.daysUntilExpiry <= 30 ? 'warning' : ''}`}>
                                        {passwordInfo.daysUntilExpiry} días
                                    </span>
                                </div>
                                <div className="pwd-expiry-bar">
                                    <div
                                        className={`pwd-expiry-fill ${passwordInfo.daysUntilExpiry <= 15 ? 'danger' : passwordInfo.daysUntilExpiry <= 30 ? 'warning' : 'ok'}`}
                                        style={{ width: `${Math.min(100, Math.max(2, (passwordInfo.daysUntilExpiry / passwordInfo.expiryDays) * 100))}%` }}
                                    />
                                </div>
                            </>
                        )}
                        {passwordInfo.expiryDays === 0 && (
                            <div className="pwd-info-row">
                                <span className="pwd-info-label">Política</span>
                                <span className="pwd-info-value">Sin expiración</span>
                            </div>
                        )}
                    </div>
                </HrSection>
            )}

            <HrSection
                eyebrow={passwordInfo ? undefined : 'Seguridad'}
                title={<><Lock size={18} aria-hidden="true" /> Cambiar Contraseña</>}
                description="Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo."
            >
                <form onSubmit={handleSubmit} className="profile-edit-form">
                    {msg && <div className={`profile-msg ${msg.type}`}>{msg.text}</div>}

                    <div className="profile-field">
                        <label htmlFor="profile-current-password">Contraseña actual</label>
                        <div className="profile-pass-wrap">
                            <input id="profile-current-password" name="currentPassword" autoComplete="current-password" type={showOld ? 'text' : 'password'} className="profile-input"
                                value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Contraseña actual" />
                            <button type="button" className="profile-pass-toggle" onClick={() => setShowOld(!showOld)} aria-label={showOld ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'} aria-pressed={showOld}>
                                {showOld ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className="profile-form-row">
                        <div className="profile-field">
                            <label htmlFor="profile-new-password">Nueva contraseña</label>
                            <div className="profile-pass-wrap">
                                <input id="profile-new-password" name="newPassword" autoComplete="new-password" type={showNew ? 'text' : 'password'} className="profile-input"
                                    value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Nueva contraseña" />
                                <button type="button" className="profile-pass-toggle" onClick={() => setShowNew(!showNew)} aria-label={showNew ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'} aria-pressed={showNew}>
                                    {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div className="profile-field">
                            <label htmlFor="profile-confirm-password">Confirmar nueva contraseña</label>
                            <input id="profile-confirm-password" name="confirmPassword" autoComplete="new-password" type="password" className="profile-input" value={confirmPwd}
                                onChange={e => setConfirmPwd(e.target.value)} placeholder="Repite la nueva contraseña" aria-invalid={confirmPwd.length > 0 && !match} aria-describedby={confirmPwd.length > 0 && !match ? 'profile-password-mismatch' : undefined} />
                            {confirmPwd.length > 0 && !match && <span className="pwd-mismatch-msg" id="profile-password-mismatch">No coinciden</span>}
                        </div>
                    </div>

                    <div className="pwd-rules-profile">
                        {PWD_RULES.map(r => (
                            <div key={r.id} className={`pwd-rule-item ${r.test(newPwd) ? 'pass' : newPwd.length > 0 ? 'fail' : ''}`}>
                                {r.test(newPwd) ? <Check size={14} /> : <X size={14} />}
                                <span>{r.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="profile-form-footer">
                        <Button type="submit" disabled={!canSubmit} variant="primary">
                            <Lock size={18} /> {saving ? 'Cambiando...' : 'Cambiar Contraseña'}
                        </Button>
                    </div>
                </form>
            </HrSection>
        </div>
    );
}

/** Sessions management */
function SessionsSection() {
    const { confirm } = useConfirmDialog();
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [loading, setLoading] = useState(true);

    const loadSessions = useCallback(async () => {
        try {
            const res = await authAPI.getSessions();
            setSessions(res.data.data || []);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { void loadSessions(); }, [loadSessions]);

    const handleRevoke = async (id: string) => {
        if (!(await confirm('¿Cerrar esta sesión?', { title: 'Confirmar acción' }))) return;
        try {
            await authAPI.revokeSession(id);
            loadSessions();
        } catch { /* ignore */ }
    };

    const handleRevokeAll = async () => {
        if (!(await confirm('¿Cerrar todas las demás sesiones?', { title: 'Confirmar acción' }))) return;
        try {
            await authAPI.revokeAllSessions();
            loadSessions();
        } catch { /* ignore */ }
    };

    return (
        <HrSection
            className="profile-tab-fade"
            title={<><Monitor size={18} aria-hidden="true" /> Sesiones Activas</>}
            count={loading ? undefined : sessions.length}
            description="Dispositivos donde tu cuenta está conectada. Puedes cerrar sesiones remotas."
            actions={!loading && sessions.length > 1 ? (
                <button type="button" className="revoke-all-btn" onClick={handleRevokeAll}>
                    <LogOut size={16} /> Cerrar todas las demás sesiones
                </button>
            ) : undefined}
        >
            {loading ? <p className="profile-inline-loading">Cargando...</p> : (
                <div className="sessions-list">
                    {sessions.length === 0 ? (
                        <div className="profile-empty">Sin sesiones registradas</div>
                    ) : sessions.map((s) => (
                        <div key={s.id} className={`session-item ${s.isCurrent ? 'current' : ''}`}>
                            <div className="session-icon">
                                {s.device === 'Móvil' ? <Smartphone size={20} /> : <Monitor size={20} />}
                            </div>
                            <div className="session-info">
                                <div className="session-device">
                                    {s.device || 'Navegador'}
                                    {s.isCurrent && <span className="session-current-badge">Sesión actual</span>}
                                </div>
                                <div className="session-meta">
                                    {s.ipAddress && <span>IP: {s.ipAddress}</span>}
                                    <span>{new Date(s.createdAt).toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                            {!s.isCurrent && (
                                <button type="button" className="session-revoke-btn" onClick={() => handleRevoke(s.id)} aria-label={`Cerrar sesión en ${s.device || 'navegador'}`}>
                                    <LogOut size={16} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </HrSection>
    );
}

/** Two-Factor Authentication */
function TwoFactorSection() {
    const { user } = useAuth();
    const [status, setStatus] = useState<'loading' | 'unavailable' | 'off' | 'setup' | 'on'>('loading');
    const [qrCode, setQrCode] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

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
            // Unknown is not the same as disabled: exposing the enable flow on
            // a failed read can misrepresent or overwrite security state.
            setStatus('unavailable');
            setError(axiosErr(err, 'No se pudo consultar el estado de 2FA.'));
        }
    }, [user?.id]);

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
        <HrSection
            className="profile-tab-fade"
            title={<><Smartphone size={18} aria-hidden="true" /> Autenticación de Dos Factores</>}
            description="Agrega una capa extra de seguridad usando Google Authenticator, Authy u otra app TOTP."
        >
            <div className="profile-stack is-tight">
                {error && <div className="profile-msg error" role="alert" aria-live="assertive">{error}</div>}

                {status === 'loading' && <p className="profile-inline-loading" role="status">Cargando estado de seguridad…</p>}

                {status === 'unavailable' && (
                    <div className="twofa-status-card is-warning">
                        <div className="twofa-status-info">
                            <Shield size={24} aria-hidden="true" />
                            <div>
                                <strong>Estado de 2FA no disponible</strong>
                                <p>No se habilitarán cambios hasta confirmar el estado actual.</p>
                            </div>
                        </div>
                        <button type="button" className="twofa-enable-btn" onClick={() => void checkStatus()}>Reintentar</button>
                    </div>
                )}

                {status === 'off' && (
                    <div className="twofa-status-card is-off">
                        <div className="twofa-status-info">
                            <Shield size={24} aria-hidden="true" />
                            <div>
                                <strong>2FA desactivado</strong>
                                <p>Tu cuenta solo está protegida con contraseña.</p>
                            </div>
                        </div>
                        <button type="button" className="twofa-enable-btn" onClick={handleSetup}>Activar 2FA</button>
                    </div>
                )}

                {status === 'setup' && (
                    <div className="twofa-setup">
                        <ol className="twofa-steps">
                            <li>
                                <p>1. Escanea este código QR con tu app de autenticación:</p>
                                {qrCode && <img src={qrCode} alt="QR Code" className="twofa-qr" />}
                            </li>
                            <li>
                                <p>2. Ingresa el código de 6 dígitos que muestra la app:</p>
                                <div className="twofa-verify-row">
                                    <input
                                        id="profile-2fa-setup-code" name="twoFactorCode" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label="Código de verificación de 6 dígitos"
                                        value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                                        className="twofa-code-input"
                                    />
                                    <button type="button" className="twofa-enable-btn" onClick={handleVerify} disabled={code.length !== 6 || saving}>
                                        {saving ? 'Verificando...' : 'Verificar y Activar'}
                                    </button>
                                </div>
                            </li>
                        </ol>
                    </div>
                )}

                {status === 'on' && (
                    <div className="twofa-status-card on">
                        <div className="twofa-status-info">
                            <ShieldCheck size={24} aria-hidden="true" />
                            <div>
                                <strong>2FA activado</strong>
                                <p>Tu cuenta tiene doble protección.</p>
                            </div>
                        </div>
                        <div className="twofa-disable-area">
                            <input
                                id="profile-2fa-disable-code" name="twoFactorDisableCode" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Código para desactivar" aria-label="Código de 6 dígitos para desactivar 2FA"
                                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                                className="twofa-code-input small"
                            />
                            <button type="button" className="twofa-disable-btn" onClick={handleDisable} disabled={code.length !== 6 || saving}>
                                Desactivar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </HrSection>
    );
}
