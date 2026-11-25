import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import type { NavGroup } from '../../navigation/navConfig';
import { Drawer } from '../overlays/Drawer';
import { IconButton } from '../primitives/IconButton';
import { NavRail } from './NavRail';
import './layout.css';

/** Estructura de la app: riel de navegación, barra superior y contenido. En < 768 px el menú es un Drawer. */
export function AppShell({ nav, collapsed, onToggleCollapsed, topbar, children, bare = false, footer }: {
  nav: NavGroup[];
  collapsed: boolean;
  onToggleCollapsed(): void;
  topbar: ReactNode;
  children: ReactNode;
  /** Sin riel ni barra (áreas de trabajo a pantalla completa como Mesas). */
  bare?: boolean;
  /** Contenido al pie del menú (cerrar sesión, etc.). */
  footer?: ReactNode;
}) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (bare) {
    return (
      <div className="ui-shell ui-shell--bare">
        <main className="ui-shell__main">{children}</main>
      </div>
    );
  }

  return (
    <div className={`ui-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className="ui-shell__rail">
        <NavRail nav={nav} activePath={pathname} expanded={!collapsed} />
        <div className="ui-shell__railfoot">
          {footer}
          <IconButton
            icon={collapsed ? ChevronRight : ChevronLeft}
            label={collapsed ? 'Expandir menú' : 'Contraer menú'}
            onClick={onToggleCollapsed}
          />
        </div>
      </aside>
      <div className="ui-shell__col">
        <header className="ui-shell__topbar">
          <IconButton className="ui-shell__menubtn" icon={Menu} label="Abrir menú" onClick={() => setMobileOpen(true)} />
          {topbar}
        </header>
        <main className="ui-shell__main">{children}</main>
      </div>
      <Drawer isOpen={mobileOpen} onClose={() => setMobileOpen(false)} title="Menú" width="sm">
        <NavRail nav={nav} activePath={pathname} expanded onNavigate={() => setMobileOpen(false)} />
        {footer}
      </Drawer>
    </div>
  );
}
