import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
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
    CreditCard,
    Calendar,
    Utensils,
    ChevronLeft,
    ChevronRight,
    Menu,
    X,
    ConciergeBell,
    Library,
    MapPin,
    Tag,
    Ticket,
    Warehouse,
    BarChart3,
    BookOpen,
    Zap,
    type LucideIcon
} from 'lucide-react';
import { getUserAccentColor, getUserRoleNames } from '../utils/authz';
import './Layout.css';

// Role-based navigation items
type NavItem = { to: string; icon: LucideIcon; label: string; roles: string[] };
type NavSection = { section: string; items: NavItem[] };

const ALL_ROLES = ['SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO', 'HOST', 'COCINA', 'BODEGA', 'CHEF'];
const ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

const NAV_SECTIONS: NavSection[] = [
    {
        section: 'Operaciones',
        items: [
            { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
            { to: '/pos', icon: CreditCard, label: 'POS', roles: ['SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO'] },
            { to: '/tables', icon: Utensils, label: 'Mesas', roles: ['SUPERADMIN', 'ADMIN', 'MESERO', 'HOST'] },
            { to: '/kitchen', icon: ChefHat, label: 'Cocina', roles: ['SUPERADMIN', 'ADMIN', 'MESERO', 'COCINA', 'CHEF'] },
            { to: '/reservations', icon: Calendar, label: 'Reservaciones', roles: ['SUPERADMIN', 'ADMIN', 'HOST', 'CAJERO'] },
            { to: '/catering', icon: ConciergeBell, label: 'Catering', roles: ['SUPERADMIN', 'ADMIN', 'CAJERO'] },
            { to: '/orders', icon: ShoppingCart, label: 'Órdenes', roles: ['SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO'] },
            { to: '/cash-registers', icon: Wallet, label: 'Caja', roles: ['SUPERADMIN', 'ADMIN', 'CAJERO'] },
        ],
    },
    {
        section: 'Gestión',
        items: [
            { to: '/menu', icon: UtensilsCrossed, label: 'Menú', roles: ['SUPERADMIN', 'ADMIN', 'CHEF'] },
            { to: '/catering-services', icon: Library, label: 'Servicios Catering', roles: ['SUPERADMIN', 'ADMIN', 'CAJERO'] },
            { to: '/categories', icon: Tag, label: 'Categorías', roles: ['SUPERADMIN', 'ADMIN', 'CHEF'] },
            { to: '/promotions', icon: Ticket, label: 'Promociones', roles: ADMIN_ROLES },
            { to: '/inventory', icon: Package, label: 'Inventario', roles: ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'] },
            { to: '/suppliers', icon: Truck, label: 'Proveedores', roles: ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'] },
            { to: '/purchase-orders', icon: ClipboardList, label: 'Órdenes de Compra', roles: ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'] },
            { to: '/warehouses', icon: Warehouse, label: 'Bodegas', roles: ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'] },
            { to: '/cost-report', icon: BarChart3, label: 'Reporte Costos', roles: ADMIN_ROLES },
            { to: '/reporteria', icon: ClipboardList, label: 'Reportería', roles: ADMIN_ROLES },
            { to: '/users', icon: Users, label: 'Usuarios', roles: ADMIN_ROLES },
        ],
    },
    {
        section: 'Configuración',
        items: [
            { to: '/branches', icon: MapPin, label: 'Sucursales', roles: ADMIN_ROLES },
            { to: '/integraciones/pedidosya', icon: Zap, label: 'PedidosYa', roles: ADMIN_ROLES },
            { to: '/companies', icon: Building2, label: 'Empresas', roles: ['SUPERADMIN'] },
            { to: '/settings', icon: Grid3x3, label: 'Configuración', roles: ADMIN_ROLES },
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
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const userRoleNames = getUserRoleNames(user);
    const userAccentColor = getUserAccentColor(user);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const toggleMobileMenu = () => {
        setIsMobileMenuOpen(!isMobileMenuOpen);
    };

    const closeMobileMenu = () => {
        setIsMobileMenuOpen(false);
    };

    return (
        <div className="layout">
            <button
                className="mobile-menu-toggle"
                onClick={toggleMobileMenu}
                aria-label="Toggle menu"
            >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {isMobileMenuOpen && (
                <div className="sidebar-overlay-mobile" onClick={closeMobileMenu} />
            )}

            <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
                <div className="sidebar-header">
                    <div className="header-brand-row">
                        <div className="brand-info">
                            <h2>Restaurant</h2>
                            <p className="sidebar-subtitle">Sistema de Gestión</p>
                        </div>

                        <button
                            className="sidebar-toggle"
                            onClick={() => setIsCollapsed(!isCollapsed)}
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
                    {NAV_SECTIONS.map((section, sIdx) => {
                        const visibleItems = section.items.filter(item => userRoleNames.some(r => item.roles.includes(r)));
                        if (visibleItems.length === 0) return null;
                        return (
                            <div key={section.section}>
                                {sIdx > 0 && <div className="nav-section-divider"></div>}
                                <div className="nav-section-title">{section.section}</div>
                                {visibleItems.map(item => (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
                                        title={item.label}
                                        onClick={closeMobileMenu}
                                    >
                                        <item.icon size={20} />
                                        <span>{item.label}</span>
                                    </NavLink>
                                ))}
                            </div>
                        );
                    })}
                </nav>

                <div className="sidebar-footer">
                    <Link to="/profile" className="user-profile-section-link">
                            <div className="user-profile-section">
                            <div className="user-avatar-mini" style={{ background: userAccentColor }}>
                                <Users size={18} />
                            </div>
                            <div className="user-text-info">
                                <div className="user-name">{user?.name}</div>
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

            <main className={`main-content ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
                <Outlet />
                <SyncStatus />
            </main>
        </div>
    );
}
