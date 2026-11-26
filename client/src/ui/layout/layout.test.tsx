// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { NAV_GROUPS, visibleNav, activeNavId } from '../../navigation/navConfig';
import type { User } from '../../types';
import { NavRail } from './NavRail';
import { StatCard } from './StatCard';
import { Tabs } from './Tabs';
import { PageHeader } from './PageHeader';
import { AppShell } from './AppShell';

const userWith = (role: string, extra: Record<string, unknown> = {}) =>
  ({ id: 1, name: 'U', roles: [role], ...extra }) as unknown as User;
const labels = (u: User) => visibleNav(NAV_GROUPS, u).flatMap((g) => g.items.map((i) => i.label));

describe('visibleNav', () => {
  it('oculta Nómina a un cajero y la muestra a quien administra RH', () => {
    expect(labels(userWith('CAJERO'))).not.toContain('Nómina y aguinaldo');
    expect(labels(userWith('SUPERADMIN'))).toContain('Nómina y aguinaldo');
  });
  it('deja las herramientas del empleado en el Perfil, no en el menú', () => {
    expect(labels(userWith('CAJERO'))).not.toContain('Marcaje');
    expect(labels(userWith('CAJERO', { accountType: 'INTERNAL', employeeId: 5 }))).not.toContain('Marcaje');
  });
  it('descarta grupos sin ítems visibles', () => {
    const ids = visibleNav(NAV_GROUPS, userWith('CAJERO')).map((g) => g.id);
    expect(ids).not.toContain('rh');
  });
  it('activeNavId elige la ruta más específica', () => {
    expect(activeNavId(NAV_GROUPS, '/rh/asistencia/configuracion')).toBe('rh-asistencia-configuracion');
    expect(activeNavId(NAV_GROUPS, '/rh/asistencia')).toBe('rh-asistencia');
  });
});

describe('NavRail', () => {
  it('marca la ruta activa con aria-current y expone etiquetas accesibles', () => {
    const nav = visibleNav(NAV_GROUPS, userWith('SUPERADMIN'));
    render(<MemoryRouter><NavRail nav={nav} activePath="/inventory" /></MemoryRouter>);
    const active = screen.getByRole('link', { name: 'Inventario' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('title', 'Inventario');
    expect(screen.getByRole('link', { name: 'Reporte Mermas' })).not.toHaveAttribute('aria-current');
  });
});

describe('StatCard', () => {
  it('muestra valor y contexto, y exige contexto por tipos', () => {
    render(<StatCard label="Ventas" value="1,200.00" context="+5% vs ayer" />);
    expect(screen.getByText('+5% vs ayer')).toBeInTheDocument();
    // @ts-expect-error context es obligatorio
    void (<StatCard label="Ventas" value="1" />);
  });
});

describe('Tabs y PageHeader', () => {
  it('Tabs notifica el cambio', async () => {
    const onChange = vi.fn();
    render(<Tabs ariaLabel="Secciones" tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} active="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('PageHeader renderiza título y acciones', () => {
    render(<PageHeader title="Inventario" description="Existencias" actions={<button>Nuevo</button>} />);
    expect(screen.getByRole('heading', { name: 'Inventario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo' })).toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('renderiza topbar, contenido y alterna el colapso', async () => {
    const onToggle = vi.fn();
    const nav = [{ id: 'g', label: 'G', items: [{ id: 'x', to: '/x', icon: Briefcase, label: 'Equis' }] }];
    render(
      <MemoryRouter initialEntries={['/x']}>
        <AppShell nav={nav} collapsed onToggleCollapsed={onToggle} topbar={<div>barra</div>}>contenido</AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('barra')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menú' }));
    expect(onToggle).toHaveBeenCalled();
  });
});
