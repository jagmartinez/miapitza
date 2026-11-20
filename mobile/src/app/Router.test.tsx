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
        deviceApi: {},
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
