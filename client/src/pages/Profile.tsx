import { useState, useEffect, useCallback } from 'react';
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
    Briefcase as BriefcaseBusiness, CalendarClock, ChevronRight, MapPin, FileText, WalletCards,
    type LucideIcon
} from 'lucide-react';
import type { User as AppUser } from '../types';
import type { Language } from '../utils/translations';
import { workforceClient } from '../components/hr/workforceClient';
import { selectVacationBalance } from '../components/hr/vacationBalance';
import type { HrMyWorkforce } from '../types/hr-workforce';
import { formatHrNumber } from '../utils/hrFormat';
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

    const [formData, setFormData] = useState({
        name: user?.name || '', email: user?.email || '',
        nif: '', address: '', phone: '',
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const [statsRes, userRes, actRes, perfRes, pwdRes] = await Promise.all([
                    reportsAPI.getMyStats(),
                    usersAPI.getById(user.id),
                    reportsAPI.getMyActivity(10),
                    reportsAPI.getMyPerformance().catch(() => null),
                    reportsAPI.getMyPasswordInfo().catch(() => null),
                ]);
                setStats(statsRes.data.data);
                setFullUserData(userRes.data.data);
                setActivities(actRes.data.data);
                if (perfRes) setPerformance(perfRes.data.data);
                if (pwdRes) setPasswordInfo(pwdRes.data.data);
                const full = userRes.data.data;
                setFormData(prev => ({ ...prev, nif: full.nif || '', address: full.address || '', phone: full.phone || '' }));
            } catch (e) { console.error('Error loading profile data:', e); }
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

    return (
        <div className="profile-page">
            <h1 className="sr-only">Mi perfil</h1>
            {/* ── Left Sidebar ── */}
            <aside className="profile-sidebar">
                <div className="profile-identity-card">
                    <div className={`profile-avatar role-${roleLower}`}>{initials}</div>
                    <h2 className="profile-user-name">{user?.name}</h2>
                    <p className="profile-user-email">{user?.email}</p>
                    <span className="profile-role-badge">{user?.role?.name ?? ''}</span>

                    <div className="profile-meta-list">
                        <div className="profile-meta-item">
                            <span className="meta-label">Usuario</span>
                            <span className="meta-value">@{user?.username}</span>
                        </div>
                        <div className="profile-meta-item">
                            <span className="meta-label">Empresa</span>
                            <span className="meta-value">{fullUserData?.company?.name || user?.company?.name || '—'}</span>
                        </div>
                        <div className="profile-meta-item">
                            <span className="meta-label">Sucursal</span>
                            <span className="meta-value">{fullUserData?.branch?.name || '—'}</span>
                        </div>
                        <div className="profile-meta-item">
                            <span className="meta-label">Miembro desde</span>
                            <span className="meta-value">
                                {fullUserData?.createdAt ? new Date(fullUserData.createdAt).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }) : '—'}
                            </span>
                        </div>
                    </div>
                </div>

                <nav className="profile-nav">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            className={`profile-nav-item ${activeTab === t.id ? 'active' : ''}`}
                            onClick={() => selectTab(t.id)}
                        >
                            <t.icon size={18} />
                            {t.label}
                        </button>
                    ))}
                </nav>
            </aside>

            {/* ── Right Content ── */}
            <div className="profile-content">
                <div className="profile-content-card">

                    {/* INFO */}
                    {activeTab === 'info' && (
                        <div className="profile-tab-fade">
                            <h3 className="profile-section-title"><User size={20} /> Editar Información</h3>
                            <form onSubmit={handleSubmit} className="profile-edit-form">
                                <div className="profile-form-row">
                                    <div className="profile-field">
                                        <label>Nombre Completo</label>
                                        <input type="text" className="profile-input" value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div className="profile-field">
                                        <label>Email</label>
                                        <input type="email" className="profile-input" value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                    </div>
                                </div>
                                <div className="profile-form-row">
                                    <div className="profile-field">
                                        <label>Cédula / NIF</label>
                                        <input type="text" className="profile-input" placeholder="001-010101-0001A"
                                            value={formData.nif} onChange={e => setFormData({ ...formData, nif: e.target.value })} />
                                    </div>
                                    <div className="profile-field">
                                        <label>Teléfono</label>
                                        <input type="text" className="profile-input" placeholder="+505 0000 0000"
                                            value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                    </div>
                                </div>
                                <div className="profile-field">
                                    <label>Dirección</label>
                                    <input type="text" className="profile-input" placeholder="Calle, Barrio, Ciudad..."
                                        value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                                </div>
                                <div className="profile-form-footer">
                                    <Button type="submit" disabled={loading} variant="primary">
                                        <Save size={18} /> {loading ? 'Guardando...' : 'Guardar Cambios'}
                                    </Button>
                                </div>
                                {message && <div className={`profile-msg ${message.type}`}>{message.text}</div>}
                            </form>
                        </div>
                    )}

                    {/* EMPLOYEE SELF-SERVICE */}
                    {activeTab === 'hr' && (
                        <div className="profile-tab-fade">
                            {!hasEmployeeContext ? (
                                <section className="profile-hr-unlinked" aria-labelledby="profile-hr-unlinked-title">
                                    <span className="profile-hr-unlinked-icon"><BriefcaseBusiness size={28} aria-hidden="true" /></span>
                                    <div>
                                        <p className="profile-hr-kicker">Mi expediente laboral</p>
                                        <h3 id="profile-hr-unlinked-title">Esta cuenta todavía no está vinculada a un empleado</h3>
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
                                </section>
                            ) : <>
                            <div className="profile-hr-heading">
                                <div>
                                    <h3 className="profile-section-title"><BriefcaseBusiness size={20} /> Mi información RH</h3>
                                    <p>Consulta tu jornada, solicitudes, pagos y beneficios personales.</p>
                                </div>
                            </div>
                            <dl className="profile-hr-identity">
                                <div><dt>Empleado</dt><dd>{user?.employee?.employeeCode ?? user?.employee?.employeeNumber ?? `#${user?.employeeId}`}</dd></div>
                                <div><dt>Estado</dt><dd>{user?.employee?.status ?? 'Vinculado'}</dd></div>
                                <div><dt>Sucursal</dt><dd>{fullUserData?.branch?.name || user?.branch?.name || 'Sin asignar'}</dd></div>
                                <div className="profile-hr-vacation-balance"><dt>Saldo de vacaciones</dt><dd>{myHrLoading ? 'Cargando…' : vacationBalance ? `${formatHrNumber(vacationBalance.available)} ${vacationBalance.unit.toLowerCase()}` : 'Sin saldo disponible'}</dd></div>
                            </dl>
                            <div className="profile-hr-grid">
                                <Link to="/rh/mi-portal/horario"><CalendarClock size={22} /><span><strong>Horario</strong><small>Calendario y turnos publicados</small></span><ChevronRight size={17} /></Link>
                                <Link to="/rh/marcaje"><MapPin size={22} /><span><strong>Marcajes</strong><small>Entrada, descansos y salida</small></span><ChevronRight size={17} /></Link>
                                <Link to="/rh/mi-portal/gestion?tab=OVERTIME"><TrendingUp size={22} /><span><strong>Horas extra</strong><small>Solicitadas, aprobadas y rechazadas</small></span><ChevronRight size={17} /></Link>
                                <Link to="/rh/mi-portal/gestion?tab=LEAVE"><Calendar size={22} /><span><strong>Vacaciones y permisos</strong><small>Crea solicitudes y revisa sus estados</small></span><ChevronRight size={17} /></Link>
                                <Link to="/rh/mi-portal/nomina"><FileText size={22} /><span><strong>Recibos de pago</strong><small>Ingresos, deducciones y colillas</small></span><ChevronRight size={17} /></Link>
                                <Link to="/rh/mi-portal/prestaciones"><WalletCards size={22} /><span><strong>Beneficios</strong><small>Viáticos, préstamos y deducciones</small></span><ChevronRight size={17} /></Link>
                            </div>
                            </>}
                        </div>
                    )}

                    {/* STATS */}
                    {activeTab === 'stats' && (
                        <div className="profile-tab-fade">
                            <h3 className="profile-section-title"><TrendingUp size={20} /> Mi Rendimiento</h3>

                            {/* KPI Cards */}
                            <div className="stats-cards-grid">
                                <div className="stat-card-mini">
                                    <div className="stat-icon sales"><CreditCard size={22} /></div>
                                    <div><div className="stat-label">Ventas Hoy</div><div className="stat-value">{formatMoney(stats?.salesToday || 0)}</div></div>
                                </div>
                                <div className="stat-card-mini">
                                    <div className="stat-icon orders"><ShoppingBag size={22} /></div>
                                    <div><div className="stat-label">Órdenes Hoy</div><div className="stat-value">{stats?.ordersToday || 0}</div></div>
                                </div>
                                <div className="stat-card-mini">
                                    <div className="stat-icon ticket"><TrendingUp size={22} /></div>
                                    <div><div className="stat-label">Ticket Prom.</div><div className="stat-value">{formatMoney(stats?.averageTicket || 0)}</div></div>
                                </div>
                                <div className="stat-card-mini">
                                    <div className="stat-icon product"><Star size={22} /></div>
                                    <div><div className="stat-label">Producto Top</div><div className="stat-value">{stats?.topProduct || '—'}</div></div>
                                </div>
                            </div>

                            {/* Weekly Chart + Comparison */}
                            {performance && (
                                <div className="perf-chart-section">
                                    <div className="perf-chart-header">
                                        <h4>Ventas Últimos 7 Días</h4>
                                        <div className={`perf-vs-badge ${performance.vsTeam >= 0 ? 'positive' : 'negative'}`}>
                                            {performance.vsTeam >= 0 ? '+' : ''}{performance.vsTeam}% vs promedio del equipo
                                        </div>
                                    </div>
                                    <div style={{ width: '100%', height: 240 }}>
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
                                </div>
                            )}

                            {/* Activity */}
                            <div className="activity-section">
                                <h4>Actividad Reciente</h4>
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
                                        <div className="activity-placeholder">
                                            <Calendar size={48} /><p>Sin actividad reciente</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PERMISSIONS */}
                    {activeTab === 'permissions' && (
                        <div className="profile-tab-fade">
                            <h3 className="profile-section-title"><Shield size={20} /> Capacidades del Rol: {user?.role?.name ?? ''}</h3>
                            <p className="permissions-summary">{fullUserData?.role?.description || 'Este rol define tus acciones permitidas en el sistema.'}</p>
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
                        </div>
                    )}

                    {/* PREFERENCES */}
                    {activeTab === 'settings' && (
                        <div className="profile-tab-fade">
                            <h3 className="profile-section-title"><Settings size={20} /> Preferencias</h3>
                            <div className="preferences-grid">
                                <div className="preference-box">
                                    <div className="pref-info">
                                        <Languages size={22} />
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
                                        {theme === 'dark' ? <Moon size={22} /> : <Sun size={22} />}
                                        <div><h4>Tema</h4><p>Modo {theme === 'dark' ? 'oscuro' : 'claro'} activo</p></div>
                                    </div>
                                    <Button variant="ghost" onClick={toggleTheme}>
                                        {theme === 'dark' ? 'Cambiar a Claro' : 'Cambiar a Oscuro'}
                                    </Button>
                                </div>
                                <div className="preference-box">
                                    <div className="pref-info">
                                        <Bell size={22} />
                                        <div><h4>Notificaciones</h4><p>Alertas en tiempo real</p></div>
                                    </div>
                                    <label className="switch"><input type="checkbox" defaultChecked /><span className="slider round"></span></label>
                                </div>
                            </div>
                        </div>
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
            <div className="profile-tab-fade" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <ShieldCheck size={56} style={{ color: 'var(--color-success)', marginBottom: 16 }} />
                <h3 className="profile-section-title" style={{ justifyContent: 'center' }}>Contraseña actualizada</h3>
                <p style={{ color: 'var(--color-text-secondary)' }}>Serás redirigido al inicio de sesión...</p>
            </div>
        );
    }

    return (
        <div className="profile-tab-fade">
            <h3 className="profile-section-title"><Lock size={20} /> Seguridad</h3>

            {/* Password Info Card */}
            {passwordInfo && (
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
            )}

            <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', margin: '24px 0 8px' }}>Cambiar Contraseña</h4>
            <p className="security-note">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</p>

            <form onSubmit={handleSubmit} className="profile-edit-form">
                {msg && <div className={`profile-msg ${msg.type}`}>{msg.text}</div>}

                <div className="profile-field">
                    <label>Contraseña Actual</label>
                    <div className="profile-pass-wrap">
                        <input type={showOld ? 'text' : 'password'} className="profile-input"
                            value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Contraseña actual" />
                        <button type="button" className="profile-pass-toggle" onClick={() => setShowOld(!showOld)}>
                            {showOld ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                <div className="profile-field">
                    <label>Nueva Contraseña</label>
                    <div className="profile-pass-wrap">
                        <input type={showNew ? 'text' : 'password'} className="profile-input"
                            value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Nueva contraseña" />
                        <button type="button" className="profile-pass-toggle" onClick={() => setShowNew(!showNew)}>
                            {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
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

                <div className="profile-field">
                    <label>Confirmar Nueva Contraseña</label>
                    <input type="password" className="profile-input" value={confirmPwd}
                        onChange={e => setConfirmPwd(e.target.value)} placeholder="Repite la nueva contraseña" />
                    {confirmPwd.length > 0 && !match && <span className="pwd-mismatch-msg">No coinciden</span>}
                </div>

                <div className="profile-form-footer">
                    <Button type="submit" disabled={!canSubmit} variant="primary">
                        <Lock size={18} /> {saving ? 'Cambiando...' : 'Cambiar Contraseña'}
                    </Button>
                </div>
            </form>
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
        <div className="profile-tab-fade">
            <h3 className="profile-section-title"><Monitor size={20} /> Sesiones Activas</h3>
            <p className="security-note">Dispositivos donde tu cuenta está conectada. Puedes cerrar sesiones remotas.</p>

            {loading ? <p style={{ color: 'var(--color-text-secondary)' }}>Cargando...</p> : (
                <>
                    <div className="sessions-list">
                        {sessions.length === 0 ? (
                            <div className="no-permissions">Sin sesiones registradas</div>
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
                                    <button className="session-revoke-btn" onClick={() => handleRevoke(s.id)} title="Cerrar sesión">
                                        <LogOut size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    {sessions.length > 1 && (
                        <button className="revoke-all-btn" onClick={handleRevokeAll}>
                            <LogOut size={16} /> Cerrar todas las demás sesiones
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

/** Two-Factor Authentication */
function TwoFactorSection() {
    const { user } = useAuth();
    const [status, setStatus] = useState<'loading' | 'off' | 'setup' | 'on'>('loading');
    const [qrCode, setQrCode] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const checkStatus = useCallback(async () => {
        try {
            if (!user?.id) {
                setStatus('off');
                return;
            }

            const userRes = await usersAPI.getById(user.id).catch(() => null);
            const enabled = Boolean(userRes?.data?.data?.twoFactorEnabled);
            setStatus(enabled ? 'on' : 'off');
        } catch {
            setStatus('off');
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
        <div className="profile-tab-fade">
            <h3 className="profile-section-title"><Smartphone size={20} /> Autenticación de Dos Factores</h3>
            <p className="security-note">Agrega una capa extra de seguridad usando Google Authenticator, Authy u otra app TOTP.</p>

            {error && <div className="profile-msg error">{error}</div>}

            {status === 'loading' && <p style={{ color: 'var(--color-text-secondary)' }}>Cargando...</p>}

            {status === 'off' && (
                <div className="twofa-status-card">
                    <div className="twofa-status-info">
                        <Shield size={24} style={{ color: 'var(--color-text-secondary)' }} />
                        <div>
                            <strong>2FA desactivado</strong>
                            <p>Tu cuenta solo está protegida con contraseña.</p>
                        </div>
                    </div>
                    <button className="twofa-enable-btn" onClick={handleSetup}>Activar 2FA</button>
                </div>
            )}

            {status === 'setup' && (
                <div className="twofa-setup">
                    <p style={{ fontWeight: 600, marginBottom: 12 }}>1. Escanea este código QR con tu app de autenticación:</p>
                    {qrCode && <img src={qrCode} alt="QR Code" className="twofa-qr" />}
                    <p style={{ fontWeight: 600, marginTop: 16, marginBottom: 8 }}>2. Ingresa el código de 6 dígitos que muestra la app:</p>
                    <div className="twofa-verify-row">
                        <input
                            type="text" maxLength={6} placeholder="000000"
                            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                            className="twofa-code-input"
                        />
                        <button className="twofa-enable-btn" onClick={handleVerify} disabled={code.length !== 6 || saving}>
                            {saving ? 'Verificando...' : 'Verificar y Activar'}
                        </button>
                    </div>
                </div>
            )}

            {status === 'on' && (
                <div className="twofa-status-card on">
                    <div className="twofa-status-info">
                        <ShieldCheck size={24} style={{ color: 'var(--color-success)' }} />
                        <div>
                            <strong>2FA activado</strong>
                            <p>Tu cuenta tiene doble protección.</p>
                        </div>
                    </div>
                    <div className="twofa-disable-area">
                        <input
                            type="text" maxLength={6} placeholder="Código para desactivar"
                            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                            className="twofa-code-input small"
                        />
                        <button className="twofa-disable-btn" onClick={handleDisable} disabled={code.length !== 6 || saving}>
                            Desactivar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
