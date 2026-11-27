import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { ConfirmProvider } from '../context/ConfirmContext';
import { ErrorBoundary } from './ErrorBoundary';
import ThemeToggle from './ThemeToggle';
import LanguageSelector from './LanguageSelector';
import NetworkStatus from './NetworkStatus';
import MobileBottomNav from './MobileBottomNav';
import SyncStatus from './SyncStatus';
import '../components/SyncStatus.css';
import { AppShell, IconButton, Topbar } from '@/ui';
import { NAV_GROUPS, activeNavId, visibleNav } from '../navigation/navConfig';
import { getUserAccentColor } from '../utils/authz';

const COLLAPSED_KEY = 'ui.nav.collapsed';

export default function Layout() {
    const { user, logout } = useAuth();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    // /tables usa el shell normal (riel + barra superior) como el mockup de Mesas; solo el KDS es de pantalla completa.
    const isTableWorkspace = location.pathname === '/kds';
    // Por defecto el riel va contraído (64 px, solo iconos).
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSED_KEY) !== 'false'; } catch { return true; }
    });

    const nav = useMemo(() => visibleNav(NAV_GROUPS, user), [user]);
    const currentGroup = useMemo(() => {
        const id = activeNavId(nav, location.pathname);
        return nav.find((g) => g.items.some((i) => i.id === id));
    }, [nav, location.pathname]);
    const currentItem = currentGroup?.items.find((i) => i.id === activeNavId(nav, location.pathname));

    const handleLogout = () => {
        void logout();
        navigate('/login');
    };

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    };

    const logoutButton = <IconButton icon={LogOut} label={t('common.logout')} onClick={handleLogout} />;

    return (
        <ConfirmProvider>
            <AppShell
                nav={nav}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                bare={isTableWorkspace}
                topbar={
                    <Topbar
                        nav={nav}
                        breadcrumb={currentGroup && currentItem ? [currentGroup.label, currentItem.label] : undefined}
                        userName={user?.name}
                        userDetail={user?.username ? `@${user.username}` : undefined}
                        onLogout={handleLogout}
                        logoutLabel={t('common.logout')}
                        accentColor={getUserAccentColor(user)}
                        controls={
                            <>
                                <NetworkStatus />
                                <ThemeToggle />
                                <LanguageSelector />
                            </>
                        }
                    />
                }
            >
                {/* A crashing page keeps the shell (menu, sync, toasts) usable; navigating resets it. */}
                <ErrorBoundary variant="page" resetKey={location.pathname}>
                    <Outlet />
                </ErrorBoundary>
                <SyncStatus />
            </AppShell>
            <MobileBottomNav nav={nav} footer={logoutButton} />
        </ConfirmProvider>
    );
}
