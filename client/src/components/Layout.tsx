import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { ConfirmProvider } from '../context/ConfirmContext';
import { ToastProvider } from '../context/ToastContext';
import ThemeToggle from './ThemeToggle';
import LanguageSelector from './LanguageSelector';
import NetworkStatus from './NetworkStatus';
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
    const isTableWorkspace = location.pathname === '/tables' || location.pathname === '/kds';
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
        logout();
        navigate('/login');
    };

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <ConfirmProvider>
        <ToastProvider>
            <AppShell
                nav={nav}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                bare={isTableWorkspace}
                footer={<IconButton icon={LogOut} label={t('common.logout')} onClick={handleLogout} />}
                topbar={
                    <Topbar
                        nav={nav}
                        breadcrumb={currentGroup && currentItem ? [currentGroup.label, currentItem.label] : undefined}
                        userName={user?.name}
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
                <Outlet />
                <SyncStatus />
            </AppShell>
        </ToastProvider>
        </ConfirmProvider>
    );
}
