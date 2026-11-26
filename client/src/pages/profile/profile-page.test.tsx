// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Profile from '../Profile';
import { DataTable, getRowsPerPage, resetUiPrefs } from '@/ui';

const api = vi.hoisted(() => ({
    getById: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    getMyStats: vi.fn(),
    getMyActivity: vi.fn(),
    getMyPerformance: vi.fn(),
    getMyPasswordInfo: vi.fn(),
    getSessions: vi.fn(),
}));

vi.mock('../../services/api', () => ({
    usersAPI: {
        getById: api.getById,
        updateProfile: vi.fn(),
        getPreferences: api.getPreferences,
        updatePreferences: api.updatePreferences,
    },
    reportsAPI: {
        getMyStats: api.getMyStats,
        getMyActivity: api.getMyActivity,
        getMyPerformance: api.getMyPerformance,
        getMyPasswordInfo: api.getMyPasswordInfo,
    },
    authAPI: {
        getSessions: api.getSessions,
        revokeSession: vi.fn(),
        revokeAllSessions: vi.fn(),
        changePassword: vi.fn(),
        setup2FA: vi.fn(),
        verify2FA: vi.fn(),
        disable2FA: vi.fn(),
    },
}));

vi.mock('../../components/hr/workforceClient', () => ({ workforceClient: { getMyWorkforce: vi.fn().mockResolvedValue(null) } }));
const auth = vi.hoisted(() => ({
    value: {
        user: { id: 7, name: 'Ana Pérez', email: 'ana@x.com', username: 'ana', role: { id: 1, name: 'CAJERO' }, accountType: 'EXTERNAL', status: 'ACTIVE', companyId: 1, branchId: 1, branch: { id: 1, name: 'Centro' } },
        logout: () => undefined,
    },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth.value }));
const theme = vi.hoisted(() => ({ value: { theme: 'light', toggleTheme: () => undefined }, lang: { language: 'es', setLanguage: () => undefined } }));
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => theme.value }));
vi.mock('../../hooks/useLanguage', () => ({ useLanguage: () => theme.lang }));

const renderAt = (path = '/profile') => render(<MemoryRouter initialEntries={[path]}><Profile /></MemoryRouter>);

beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    localStorage.clear();
    resetUiPrefs();
    api.getById.mockResolvedValue({ data: { data: { id: 7, name: 'Ana Pérez', email: 'ana@x.com', nif: '', phone: '555', address: '', createdAt: '2025-01-01T00:00:00Z', role: { id: 1, name: 'CAJERO', description: 'Caja', permissions: [{ id: 1, name: 'orders.read', description: 'Ver órdenes' }] }, branch: { id: 1, name: 'Centro' }, company: { id: 1, name: 'Miapitza' }, twoFactorEnabled: false } } });
    api.getPreferences.mockResolvedValue({ data: { data: { density: 'comfortable', rowsPerPage: 25, homePage: null, defaultBranchId: null, numberFormat: 'es-NI', notifications: {} } } });
    api.updatePreferences.mockImplementation((patch: Record<string, unknown>) => Promise.resolve({ data: { data: { density: 'comfortable', rowsPerPage: 25, homePage: null, defaultBranchId: null, numberFormat: 'es-NI', notifications: {}, ...patch } } }));
    api.getMyStats.mockResolvedValue({ data: { data: { salesToday: 1200, ordersToday: 4, averageTicket: 300, topProduct: 'Pizza' } } });
    api.getMyActivity.mockResolvedValue({ data: { data: [{ id: 1, description: 'Orden #1', date: '2026-11-20T10:00:00Z', amount: 100, status: 'PAID' }] } });
    api.getMyPerformance.mockResolvedValue({ data: { data: { vsTeam: 5, myWeekTotal: 700, dailyData: [{ day: 'Lun', mySales: 100, teamAvg: 80 }, { day: 'Mar', mySales: 120, teamAvg: 90 }] } } });
    api.getMyPasswordInfo.mockResolvedValue({ data: { data: { passwordChangedAt: '2026-10-01T00:00:00Z', daysUntilExpiry: 10, expiryDays: 90 } } });
    api.getSessions.mockResolvedValue({ data: { data: [{ id: 's1', device: 'Navegador', isCurrent: true, ipAddress: '10.0.0.1', createdAt: '2026-11-20T10:00:00Z' }] } });
});

describe('Profile page', () => {
    it('muestra el encabezado, las cuatro pestañas y el resumen con datos reales (sin 0 inventados)', async () => {
        renderAt();
        expect(await screen.findByRole('heading', { level: 1, name: 'Mi perfil' })).toBeInTheDocument();
        const tabs = screen.getByRole('tablist', { name: 'Secciones de mi perfil' });
        expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Resumen', 'Seguridad y accesos', 'Preferencias', 'Notificaciones']);
        const sales = await screen.findByRole('region', { name: 'Ventas de hoy' });
        await waitFor(() => expect(sales).toHaveTextContent('4 órdenes'));
        expect(screen.getByText(/Perfil completo al/)).toBeInTheDocument();
        expect(await screen.findByRole('table', { name: 'Actividad reciente' })).toBeInTheDocument();
    });

    it('si las ventas no cargan dice "No disponible" y no 0', async () => {
        api.getMyStats.mockRejectedValue(new Error('x'));
        renderAt();
        const card = await screen.findByRole('region', { name: 'Ventas de hoy' });
        await waitFor(() => expect(card).toHaveTextContent('No disponible'));
        expect(card).not.toHaveTextContent(/C\$ 0/);
    });

    it('un enlace antiguo ?tab=2fa abre Seguridad y accesos con salud, sesiones y matriz de permisos', async () => {
        renderAt('/profile?tab=2fa');
        expect(await screen.findByLabelText('Salud de la cuenta')).toBeInTheDocument();
        expect(await screen.findByRole('table', { name: 'Sesiones y accesos recientes' })).toBeInTheDocument();
        expect(await screen.findByRole('table', { name: 'Permisos del rol CAJERO' })).toHaveTextContent('orders.read');
    });

    it('cambiar "Filas por página" a 50 guarda en el servidor y un DataTable nuevo arranca en 50', async () => {
        renderAt('/profile?tab=preferencias');
        const group = await screen.findByRole('group', { name: 'Filas por página (preferencia)' });
        await userEvent.click(within(group).getByRole('button', { name: '50' }));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
        await waitFor(() => expect(api.updatePreferences).toHaveBeenCalled());
        expect(api.updatePreferences.mock.calls[0][0]).toMatchObject({ rowsPerPage: 50 });
        await waitFor(() => expect(getRowsPerPage()).toBe(50));

        const rows = Array.from({ length: 80 }, (_, i) => ({ id: i }));
        render(<DataTable columns={[{ key: 'id', header: 'Id' }]} rows={rows} rowKey={(r) => r.id} ariaLabel="Nueva" />);
        expect(screen.getByText('1–50 de 80')).toBeInTheDocument();
    });

    it('si las preferencias no cargan no muestra valores por defecto editables: ofrece reintentar', async () => {
        api.getPreferences.mockRejectedValue(new Error('x'));
        renderAt('/profile?tab=preferencias');
        expect(await screen.findByText(/No pudimos cargar tus preferencias/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Guardar preferencias' })).not.toBeInTheDocument();
    });

    it('la matriz de notificaciones guarda evento por canal', async () => {
        renderAt('/profile?tab=notificaciones');
        const box = await screen.findByRole('checkbox', { name: 'Nómina Correo' });
        await userEvent.click(box);
        await userEvent.click(screen.getByRole('button', { name: 'Guardar notificaciones' }));
        await waitFor(() => expect(api.updatePreferences).toHaveBeenCalled());
        expect(api.updatePreferences.mock.calls[0][0].notifications.payroll).toEqual({ app: true, email: true });
    });
});
