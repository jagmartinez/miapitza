import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router } from './Router';
import { appEvents } from '../core/events';
import type { Services } from '../core/services';
import { createSessionStore, memoryStore } from '../core/session';
import { fakeApi, pathOf, session } from '../test/helpers';

function build() {
    const api = fakeApi(() => ({ data: { success: true, data: [] } }));
    const sessions = createSessionStore(memoryStore());
    const keystoreFailure = () => Promise.reject(new Error('keystore'));
    const services = {
        sessions,
        http: api.http,
        realtime: { close: vi.fn(), reconnect: vi.fn(), connect: vi.fn(), subscribe: vi.fn() },
        deviceApi: { cancel: vi.fn().mockResolvedValue(undefined) },
        pinApi: {
            roster: vi.fn().mockResolvedValue([{ id: 7, name: 'Ana Perez', initials: 'AP', color: null }]),
            login: vi.fn().mockResolvedValue(session),
            logout: vi.fn(keystoreFailure),
        },
        accountApi: { login: vi.fn(), logout: vi.fn(keystoreFailure) },
    } as unknown as Services;
    return { services, sessions, api };
}

describe('Router', () => {
    it('Cambiar usuario locks back to the PIN screen even when logout rejects', async () => {
        const { services, sessions } = build();
        await sessions.saveDeviceType('SERVICE_TABLET');
        render(<Router services={services} />);
        fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
        for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await screen.findByRole('button', { name: 'Mis mesas' }); // the tables screen, not the loading placeholder (its button is replaced)
        fireEvent.click(await screen.findByRole('button', { name: 'Cambiar usuario' }));
        expect(await screen.findByText('Elige tu usuario')).toBeInTheDocument();
    });

    it('account logout returns to the login form even when logout rejects', async () => {
        const { services, sessions } = build();
        await sessions.saveDeviceType('PERSONAL');
        await sessions.save(session);
        render(<Router services={services} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Salir' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument());
    });

    it('revokes a stale stored session server-side when a shared tablet starts', async () => {
        const { services, sessions, api } = build();
        await sessions.saveDeviceType('SERVICE_TABLET');
        await sessions.save(session);
        render(<Router services={services} />);
        await screen.findByText('Elige tu usuario');
        const logout = api.calls.find((c) => pathOf(c) === 'POST /auth/logout');
        expect(logout?.headers.get('Authorization')).toBe('Bearer tok-1');
        expect(await sessions.load()).toBeNull();
    });
});

describe('Router lock and storage resilience', () => {
    it('Cambiar usuario locks at once even when logout never resolves', async () => {
        const { services, sessions } = build();
        (services.pinApi.logout as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
        await sessions.saveDeviceType('SERVICE_TABLET');
        render(<Router services={services} />);
        fireEvent.click(await screen.findByRole('button', { name: /Ana Perez/ }));
        for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await screen.findByRole('button', { name: 'Mis mesas' }); // the tables screen, not the loading placeholder (its button is replaced)
        fireEvent.click(await screen.findByRole('button', { name: 'Cambiar usuario' }));
        expect(await screen.findByText('Elige tu usuario')).toBeInTheDocument();
    });

    it('account logout locks at once even when logout never resolves', async () => {
        const { services, sessions } = build();
        (services.accountApi.logout as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
        await sessions.saveDeviceType('PERSONAL');
        await sessions.save(session);
        render(<Router services={services} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Salir' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument());
    });

    it('lands on setup instead of a blank screen when the store throws on load', async () => {
        const { services } = build();
        const boom = () => Promise.reject(new Error('keystore'));
        Object.assign(services.sessions, { deviceType: boom, load: boom });
        render(<Router services={services} />);
        expect(await screen.findByText('¿Qué es este dispositivo?')).toBeInTheDocument();
    });

    it('lands on setup when the underlying Keystore reads throw', async () => {
        const { services } = build();
        const sessions = createSessionStore({
            get: () => Promise.reject(new Error('keystore')),
            set: () => Promise.reject(new Error('keystore')),
            remove: () => Promise.reject(new Error('keystore')),
        });
        render(<Router services={{ ...services, sessions } as Services} />);
        expect(await screen.findByText('¿Qué es este dispositivo?')).toBeInTheDocument();
    });

    it('a revoked device still reaches setup when clearing storage throws', async () => {
        const { services, sessions } = build();
        await sessions.saveDeviceType('SERVICE_TABLET');
        const boom = () => Promise.reject(new Error('keystore'));
        const failing = Object.assign(Object.create(sessions), { clear: boom, clearDevice: boom });
        const roster401 = Object.assign(new Error('401'), { response: { status: 401 } });
        const pin = { ...services.pinApi, roster: vi.fn().mockRejectedValue(roster401) };
        render(<Router services={{ ...services, sessions: failing, pinApi: pin } as unknown as Services} />);
        expect(await screen.findByText('¿Qué es este dispositivo?')).toBeInTheDocument();
    });
});

describe('follow-up M7: a revoked device wipes the local database', () => {
    it('a revoked roster clears queue and drafts of every owner and lands on device setup', async () => {
        const { services, sessions } = build();
        const { loadWaiterData } = await import('../data/loadWaiterData');
        const { MobileDB } = await import('../data/cache');
        const data = await loadWaiterData(services);
        await data.db.syncQueue.add({ url: '/orders/1/items', method: 'POST', data: {}, timestamp: 1, operationType: 'ADD_ORDER_ITEM', status: 'pending', retryCount: 0, ownerKey: '1:99' });
        await data.db.drafts.put({ id: '1:99:o:5', ownerKey: '1:99', tableId: 2, orderId: 5, data: { items: [] }, updatedAt: Date.now() });
        (services.pinApi.roster as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
        await sessions.saveDeviceType('SERVICE_TABLET');
        render(<Router services={services} />);
        expect(await screen.findByText('¿Qué es este dispositivo?')).toBeInTheDocument();
        await waitFor(async () => {
            const fresh = new MobileDB();
            expect(await fresh.syncQueue.count()).toBe(0);
            expect(await fresh.drafts.count()).toBe(0);
            fresh.close();
        });
    });
});

describe('kitchen mode', () => {
    it('keeps KitchenHome mounted while the session is renewed', async () => {
        const kitchenUser = { id: 3, name: 'Cocina', roles: ['COCINA'], permissions: [] };
        let n = 0;
        const api = fakeApi((config) =>
            pathOf(config) === 'POST /auth/device-login'
                ? { data: { success: true, data: { token: `k-${++n}`, user: kitchenUser } } }
                : { data: { success: true, data: [] } },
        );
        const { services } = build();
        const kitchenServices = { ...services, http: api.http, sessions: api.sessions } as Services;
        await api.sessions.saveDeviceType('KITCHEN_TABLET');
        await api.sessions.saveDeviceToken('dev-1');
        render(<Router services={kitchenServices} />);
        const home = await screen.findByTestId('kitchen-home');
        await waitFor(() => expect(home).toHaveAttribute('data-has-session', 'true'));
        appEvents.emit('realtime-status', 'online');

        await api.sessions.clear();
        appEvents.emit('session-expired');
        await waitFor(() => expect(home).toHaveAttribute('data-has-session', 'false'));
        expect(home).toBeInTheDocument();
        expect(screen.getByTestId('kitchen-home')).toBe(home); // same instance, never unmounted
        await waitFor(() => expect(home).toHaveAttribute('data-has-session', 'true'), { timeout: 4000 });
        expect(screen.getByTestId('kitchen-home')).toBe(home);
        expect(n).toBe(2);
    });
});
