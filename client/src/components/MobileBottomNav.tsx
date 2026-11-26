import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Drawer, NavRail } from '@/ui';
import type { NavGroup } from '../navigation/navConfig';
import './MobileBottomNav.css';

/** Accesos rápidos de la barra inferior (teléfono y tableta, hasta 1024 px); el resto vive en "Más". */
export const MOBILE_QUICK_NAV_IDS = ['dashboard', 'tables', 'kitchen', 'reservations', 'orders'] as const;

const QUICK_LABEL: Record<string, string> = { dashboard: 'Inicio' };

/**
 * Navegación inferior fija con filtro por rol/permiso (recibe `nav` ya filtrado por visibleNav)
 * y un cajón "Más" con el menú completo.
 */
export default function MobileBottomNav({ nav, footer }: { nav: NavGroup[]; footer?: ReactNode }) {
    const [open, setOpen] = useState(false);
    const { pathname } = useLocation();
    const items = nav.flatMap((group) => group.items);
    const quick = MOBILE_QUICK_NAV_IDS
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (quick.length === 0) return null;

    return (
        <>
            <nav className="mobile-bottom-nav" aria-label="Acceso rápido">
                {quick.map((item) => (
                    <NavLink
                        key={item.id}
                        to={item.to}
                        className={({ isActive }) => (isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item')}
                        title={QUICK_LABEL[item.id] ?? item.label}
                    >
                        <item.icon size={22} aria-hidden="true" />
                        <span>{QUICK_LABEL[item.id] ?? item.label}</span>
                    </NavLink>
                ))}
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mobile-bottom-nav-item"
                    aria-label="Más opciones"
                >
                    <Menu size={22} aria-hidden="true" />
                    <span>Más</span>
                </button>
            </nav>
            <Drawer isOpen={open} onClose={() => setOpen(false)} title="Menú" width="sm">
                <NavRail nav={nav} activePath={pathname} expanded onNavigate={() => setOpen(false)} />
                {footer}
            </Drawer>
        </>
    );
}
