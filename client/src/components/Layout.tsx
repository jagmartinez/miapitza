import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { ConfirmProvider } from '../context/ConfirmContext';
import { ToastProvider } from '../context/ToastContext';
import ThemeToggle from './ThemeToggle';
import LanguageSelector from './LanguageSelector';
import NetworkStatus from './NetworkStatus';
import SyncStatus from './SyncStatus';
import '../components/SyncStatus.css';
import {
    LayoutDashboard,
    ShoppingCart,
    UtensilsCrossed,
    Package,
    Users,
    LogOut,
    Grid3x3,
    Truck,
    ClipboardList,
    Wallet,
    Building2,
    ChefHat,
    Calendar,
    Utensils,
    ChevronLeft,
    ChevronRight,
    ConciergeBell,
    Library,
    MapPin,
    Tag,
    Tags,
    Ticket,
    Warehouse,
    BarChart3,
    BookOpen,
    Zap,
    Ruler,
    Menu,
    X,
    TrendingDown,
    FileText,
    ShoppingBag,
    FlaskConical,
    Factory,
    Briefcase,
    SlidersHorizontal,
    BadgeDollarSign,
    Landmark,
    type LucideIcon
} from 'lucide-react';
import { getUserAccentColor, getUserRoleNames, hasPermission } from '../utils/authz';
import {
    ROLES,
    ADMIN,
    PLATFORM_ADMIN,
    OPS,
    CASHIER,
    WAITER_TABLE,
    KITCHEN_ROLES,
    HOST_ROLES,
    WAREHOUSE,
    CHEF_MGMT,
    HR_OWNER,
} from '../constants/roles';
import './Layout.css';

// Role-based navigation items
type NavItem = { to: string; icon: LucideIcon; label: string; roles?: string[]; permission?: string };
type NavSection = { section: string; items: NavItem[] };

const ALL_ROLES: string[] = Object.values(ROLES);

// Quick-access bottom nav for mobile (max 6 items, role-filtered)
const MOBILE_QUICK_NAV: NavItem[] = [
    { to: '/dashboard', icon: BarChart3, label: 'BI', roles: ALL_ROLES },
    { to: '/tables', icon: Utensils, label: 'Mesas', roles: WAITER_TABLE, permission: 'tables.map.view' },
    { to: '/kitchen', icon: ChefHat, label: 'Cocina', roles: KITCHEN_ROLES, permission: 'kds.view' },
    { to: '/reservations', icon: Calendar, label: 'Reservaciones', roles: HOST_ROLES },
    { to: '/orders', icon: ShoppingCart, label: 'Órdenes', roles: OPS, permission: 'orders.view' },
    // { to: '/menu', icon: UtensilsCrossed, label: 'Menú', roles: CHEF_MGMT },
];

const NAV_SECTIONS: NavSection[] = [
    {
        section: 'Operaciones',
        items: [
            { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
            { to: '/tables', icon: Utensils, label: 'Mesas', roles: WAITER_TABLE, permission: 'tables.map.view' },
            { to: '/kitchen', icon: ChefHat, label: 'Cocina', roles: KITCHEN_ROLES, permission: 'kds.view' },
            { to: '/reservations', icon: Calendar, label: 'Reservaciones', roles: HOST_ROLES },
            { to: '/catering', icon: ConciergeBell, label: 'Catering', roles: CASHIER },
            { to: '/orders', icon: ShoppingCart, label: 'Órdenes', roles: OPS, permission: 'orders.view' },
            { to: '/cash-registers', icon: Wallet, label: 'Caja', roles: CASHIER },
        ],
    },
    {
        section: 'Gestión',
        items: [
            { to: '/menu', icon: UtensilsCrossed, label: 'Menú', roles: CHEF_MGMT, permission: 'view_menu' },
            { to: '/catering-services', icon: Library, label: 'Catálogo Catering', roles: CASHIER },
            { to: '/categories', icon: Tag, label: 'Categorías', roles: CHEF_MGMT, permission: 'view_menu' },
            { to: '/menu-brands', icon: Tags, label: 'Marcas', roles: CHEF_MGMT, permission: 'view_menu' },
            { to: '/promotions', icon: Ticket, label: 'Promociones', roles: ADMIN },
            { to: '/inventory', icon: Package, label: 'Inventario', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/production-recipes', icon: FlaskConical, label: 'Recetas de Producción', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/production-orders', icon: Factory, label: 'Producción', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/production-dashboard', icon: BarChart3, label: 'Panel de Producción', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/units-of-measure', icon: Ruler, label: 'Unidades de Medida', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/suppliers', icon: Truck, label: 'Proveedores', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/purchase-orders', icon: ShoppingBag, label: 'Órdenes de Compra', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/warehouses', icon: Warehouse, label: 'Bodegas', roles: WAREHOUSE, permission: 'view_inventory' },
            { to: '/cost-report', icon: BarChart3, label: 'Reporte Costos', roles: ADMIN, permission: 'view_reports' },
            { to: '/waste-report', icon: TrendingDown, label: 'Reporte Mermas', roles: ADMIN, permission: 'view_reports' },
            { to: '/bank-reconciliation', icon: Wallet, label: 'Conciliación Bancaria', roles: ADMIN, permission: 'view_reports' },
            { to: '/invoices', icon: FileText, label: 'Facturas', roles: CASHIER, permission: 'invoices.view' },
            { to: '/reporteria', icon: ClipboardList, label: 'Reportería', roles: ADMIN, permission: 'view_reports' },
            { to: '/users', icon: Users, label: 'Usuarios', roles: ADMIN, permission: 'view_users' },
        ],
    },
    {
        section: 'Recursos Humanos',
        items: [
            { to: '/rh', icon: Briefcase, label: 'Panel RH', roles: HR_OWNER, permission: 'hr.dashboard.read' },
            { to: '/rh/personal', icon: Users, label: 'Personal', roles: HR_OWNER, permission: 'hr.employee.read' },
            { to: '/rh/horarios', icon: Calendar, label: 'Horarios', roles: HR_OWNER, permission: 'hr.schedule.read' },
            { to: '/rh/asistencia', icon: ClipboardList, label: 'Asistencia', roles: HR_OWNER, permission: 'hr.attendance.review' },
            { to: '/rh/jornadas', icon: ClipboardList, label: 'Jornadas y extras', roles: HR_OWNER, permission: 'hr.workforce.read' },
            { to: '/rh/ausencias', icon: Calendar, label: 'Solicitudes y vacaciones', roles: HR_OWNER, permission: 'hr.workforce.read' },
            { to: '/rh/nomina', icon: Wallet, label: 'Nómina y aguinaldo', roles: HR_OWNER, permission: 'hr.payroll.read' },
            { to: '/rh/nomina/configuracion-legal', icon: Landmark, label: 'Reglas IR, INSS e INATEC', roles: HR_OWNER, permission: 'hr.payroll.manage' },
            { to: '/rh/prestaciones', icon: BadgeDollarSign, label: 'Préstamos y viáticos', roles: HR_OWNER, permission: 'hr.benefits.read' },
            { to: '/rh/asistencia/configuracion', icon: SlidersHorizontal, label: 'Configurar asistencia', roles: HR_OWNER, permission: 'hr.attendance.manage' },
        ],
    },
    {
        section: 'Configuración',
        items: [
            { to: '/branches', icon: MapPin, label: 'Sucursales', roles: ADMIN, permission: 'view_branches' },
            { to: '/integraciones/pedidosya', icon: Zap, label: 'PedidosYa', roles: ADMIN },
            { to: '/companies', icon: Building2, label: 'Empresas', roles: PLATFORM_ADMIN },
            { to: '/roles-permissions', icon: Users, label: 'Roles y Permisos', roles: ADMIN },
            { to: '/settings', icon: Grid3x3, label: 'Configuración', roles: ADMIN },
        ],
    },
    {
        section: 'Ayuda',
        items: [
            { to: '/manual', icon: BookOpen, label: 'Manual', roles: ALL_ROLES },
        ],
    },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const isTableWorkspace = location.pathname === '/tables' || location.pathname === '/kds';
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
    });
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const userRoleNames = getUserRoleNames(user);
    const userAccentColor = getUserAccentColor(user);
    const isInternalEmployee = user?.accountType === 'INTERNAL' && Boolean(user.employeeId);

    const handleLogout = () => {
        void logout();
        navigate('/login');
    };

    const toggleSidebar = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem('sidebar-collapsed', String(next)); } catch { /* ignore */ }
            return next;
        });
    };

    const renderNavSections = (onNavigate?: () => void) =>
        NAV_SECTIONS.map((section, sIdx) => {
            const visibleItems = section.items.filter(item =>
                item.permission
                    ? hasPermission(user, item.permission, item.roles)
                    : !item.roles || userRoleNames.some(r => item.roles!.includes(r))
            );
            if (visibleItems.length === 0) return null;
            return (
                <div key={section.section}>
                    {sIdx > 0 && <div className="nav-section-divider"></div>}
                    <div className="nav-section-title">{section.section}</div>
                    {visibleItems.map(item => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === '/rh' || item.to === '/rh/asistencia' || item.to === '/rh/nomina' || item.to === '/rh/mi-portal'}
                            className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
                            title={item.label}
                            onClick={onNavigate}
                        >
                            <item.icon size={20} />
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </div>
            );
        });

    return (
        <ConfirmProvider>
        <ToastProvider>
        <div className={`layout ${isTableWorkspace ? 'workspace-layout' : ''}`}>
            <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header">
                    <div className="header-brand-row">
                        <div className="brand-info">
                            <h2>Restaurant</h2>
                            <p className="sidebar-subtitle">Sistema de Gestión</p>
                        </div>

                        <button
                            className="sidebar-toggle"
                            onClick={toggleSidebar}
                            title={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
                        >
                            {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                        </button>
                    </div>

                    <div className="header-controls-row">
                        <NetworkStatus />
                        <div className="controls-divider"></div>
                        <ThemeToggle />
                        <LanguageSelector />
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {renderNavSections()}
                </nav>

                <div className="sidebar-footer">
                    <Link to="/profile" className="user-profile-section-link">
                            <div className="user-profile-section">
                            <div className="user-avatar-mini" style={{ background: userAccentColor }}>
                                <Users size={18} />
                            </div>
                            <div className="user-text-info">
                                <div className="user-name">{user?.name}</div>
                                {isInternalEmployee && <div className="user-profile-destination">Perfil y Mi RH</div>}
                                <div className="user-role">{userRoleNames.join(' / ')}</div>
                            </div>
                        </div>
                    </Link>

                    <button onClick={handleLogout} className="logout-btn-premium" title={t('common.logout')}>
                        <LogOut size={18} />
                        <span>{t('common.logout')}</span>
                    </button>

                    <button onClick={handleLogout} className="logout-icon-only" title={t('common.logout')}>
                        <LogOut size={20} />
                    </button>
                </div>
            </aside>

            <main
                className={`main-content ${isCollapsed ? 'sidebar-collapsed' : ''} ${isTableWorkspace ? 'workspace-content' : ''}`}
                onClick={() => {
                    if (!isCollapsed) {
                        setIsCollapsed(true);
                        try { localStorage.setItem('sidebar-collapsed', 'true'); } catch { /* ignore */ }
                    }
                }}
            >
                <div className="main-content-inner">
                    <Outlet />
                </div>
                <SyncStatus />
            </main>

            {(() => {
                const visibleQuickItems = MOBILE_QUICK_NAV.filter(item =>
                    item.permission
                        ? hasPermission(user, item.permission, item.roles)
                        : !item.roles || userRoleNames.some(r => item.roles!.includes(r))
                );
                if (visibleQuickItems.length === 0) return null;
                return (
                    <nav className="mobile-bottom-nav" aria-label="Acceso rápido">
                        {visibleQuickItems.map(item => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                className={({ isActive }) =>
                                    isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item'
                                }
                                title={item.label}
                            >
                                <item.icon size={22} />
                                <span>{item.label}</span>
                            </NavLink>
                        ))}
                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(true)}
                            className="mobile-bottom-nav-item"
                            aria-label="Más opciones"
                        >
                            <Menu size={22} />
                            <span>Más</span>
                        </button>
                    </nav>
                );
            })()}

            {mobileMenuOpen && (
                <>
                    <div
                        className="mobile-menu-overlay"
                        onClick={() => setMobileMenuOpen(false)}
                        aria-hidden="true"
                    />
                    <aside className="mobile-menu-drawer" aria-label="Menú de navegación">
                        <div className="mobile-menu-header">
                            <h2>Menú</h2>
                            <button
                                type="button"
                                className="mobile-menu-close"
                                onClick={() => setMobileMenuOpen(false)}
                                aria-label="Cerrar menú"
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div className="header-controls-row mobile-menu-controls">
                            <ThemeToggle />
                            <LanguageSelector />
                            <NetworkStatus />
                        </div>
                        <nav className="mobile-menu-nav">
                            {renderNavSections(() => setMobileMenuOpen(false))}
                        </nav>
                        <div className="mobile-menu-footer">
                            <Link
                                to="/profile"
                                className="user-profile-section-link"
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                <div className="user-profile-section">
                                    <div className="user-avatar-mini" style={{ background: userAccentColor }}>
                                        <Users size={18} />
                                    </div>
                                    <div className="user-text-info">
                                        <div className="user-name">{user?.name}</div>
                                        {isInternalEmployee && <div className="user-profile-destination">Perfil y Mi RH</div>}
                                        <div className="user-role">{userRoleNames.join(' / ')}</div>
                                    </div>
                                </div>
                            </Link>
                            <button onClick={handleLogout} className="logout-btn-premium" title={t('common.logout')}>
                                <LogOut size={18} />
                                <span>{t('common.logout')}</span>
                            </button>
                        </div>
                    </aside>
                </>
            )}
        </div>
        </ToastProvider>
        </ConfirmProvider>
    );
}
