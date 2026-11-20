import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router } from './Router';
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
