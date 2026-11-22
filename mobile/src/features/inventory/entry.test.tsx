import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router } from '../../app/Router';
import type { Services } from '../../core/services';
import { createSessionStore, memoryStore, type Session } from '../../core/session';
import { fakeApi, pathOf, session } from '../../test/helpers';

configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);

const withPermissions = (permissions: string[], role = 'MESERO'): Session => ({ ...session, user: { ...session.user, role: { id: 1, name: role }, roles: [role], permissions } });

async function enter(login: Session) {
    const api = fakeApi(() => ({ data: { success: true, data: [] } }));
    const sessions = createSessionStore(memoryStore());
    const services = {
        sessions,
        http: api.http,
        realtime: { close: vi.fn(), reconnect: vi.fn(), connect: vi.fn(), subscribe: vi.fn(() => () => {}) },
        deviceApi: { cancel: vi.fn().mockResolvedValue(undefined) },
        pinApi: {
            roster: vi.fn().mockResolvedValue([{ id: 7, name: 'Ana Perez', initials: 'AP', color: null }]),
            login: vi.fn(async () => {
                await sessions.save(login);
                return login;
            }),
            logout: vi.fn().mockResolvedValue(undefined),
        },
        accountApi: { login: vi.fn(), logout: vi.fn() },
    } as unknown as Services;
    await sessions.saveDeviceType('SERVICE_TABLET');
    render(<Router services={services} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
    for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    return api;
}

describe('Inventario entry routes', () => {
    it('inventory-only user lands on Inventario without loading tables', async () => {
        const api = await enter(withPermissions(['inventory.count'], 'BODEGA'));
        await screen.findByTestId('inventory-entry');
        expect(screen.getByText('Inventario')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull());
        expect(api.calls.some((c) => pathOf(c).includes('/tables/plan'))).toBe(false);
        expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull(); // no tables to go back to
    });

    it('waiter with inventory.count sees Inventario in tables header', async () => {
        await enter(withPermissions(['tables.map.view', 'inventory.count']));
        expect(await screen.findByRole('button', { name: 'Inventario' })).toBeInTheDocument();
    });

    it('waiter without inventory.count does not', async () => {
        await enter(withPermissions(['tables.map.view']));
        await screen.findByRole('button', { name: 'Mis mesas' });
        expect(screen.queryByRole('button', { name: 'Inventario' })).toBeNull();
    });

    it('Inventario back returns to tables', async () => {
        await enter(withPermissions(['tables.map.view', 'inventory.count']));
        fireEvent.click(await screen.findByRole('button', { name: 'Inventario' }));
        await screen.findByTestId('inventory-entry');
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
        expect(await screen.findByRole('button', { name: 'Mis mesas' })).toBeInTheDocument();
        expect(screen.queryByTestId('inventory-entry')).toBeNull();
    });
});
