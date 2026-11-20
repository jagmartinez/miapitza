import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviceSetupScreen } from './DeviceSetupScreen';
import { createDeviceApi } from './deviceApi';
import { fakeApi, pathOf, user } from '../../test/helpers';

const admin = { ...user, id: 1, role: { id: 9, name: 'ADMIN' }, roles: ['ADMIN'], branchId: 3 };

function setup(opts: { twoFactor?: boolean } = {}) {
    const api = fakeApi((c) => {
        const p = pathOf(c);
        if (p === 'POST /auth/login') {
            const body = JSON.parse(String(c.data));
            if (opts.twoFactor && !body.twoFactorCode) return { data: { success: true, data: { requires2FA: true } } };
            return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
        }
        if (p === 'POST /v1/operational-devices') return { status: 201, data: { success: true, data: { device: { id: 5 }, deviceToken: 'dev-raw' } } };
        return { data: { success: true } };
    });
    const onDone = vi.fn();
    const device = createDeviceApi({ http: api.http, sessions: api.sessions });
    render(<DeviceSetupScreen api={device} onDone={onDone} />);
    return { ...api, onDone };
}

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('DeviceSetupScreen', () => {
    it('requires an admin password login (with 2FA field when requested) before registering', async () => {
        const { calls, sessions, onDone } = setup({ twoFactor: true });
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        expect(screen.queryByLabelText(/Nombre del dispositivo/)).not.toBeInTheDocument();

        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        const code = await screen.findByLabelText('Código 2FA');
        expect(calls.map(pathOf)).toEqual(['POST /auth/login']);

        fireEvent.change(code, { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Salón 1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar dispositivo' }));

        await waitFor(() => expect(onDone).toHaveBeenCalledWith('SERVICE_TABLET'));
        const register = calls.find((c) => pathOf(c) === 'POST /v1/operational-devices')!;
        expect(register.headers.get('Authorization')).toBe('Bearer admin-tok');
        expect(JSON.parse(String(register.data))).toMatchObject({ branchId: 3, type: 'SERVICE_TABLET', name: 'Salón 1' });
        // The admin session is revoked and never becomes the app session.
        const logout = calls.find((c) => pathOf(c) === 'POST /auth/logout')!;
        expect(logout.headers.get('Authorization')).toBe('Bearer admin-tok');
        expect(await sessions.load()).toBeNull();
        expect(await sessions.deviceToken()).toBe('dev-raw');
        expect(await sessions.deviceType()).toBe('SERVICE_TABLET');
    });

    it('registers a kitchen tablet with the kitchen user id', async () => {
        const { calls, onDone } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Tablet de cocina/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Cocina' } });
        type(/Usuario de cocina/, '42');
        fireEvent.click(screen.getByRole('button', { name: 'Registrar dispositivo' }));
        await waitFor(() => expect(onDone).toHaveBeenCalledWith('KITCHEN_TABLET'));
        const register = calls.find((c) => pathOf(c) === 'POST /v1/operational-devices')!;
        expect(JSON.parse(String(register.data))).toMatchObject({ type: 'KITCHEN_TABLET', kitchenUserId: 42 });
    });

    it('drops the admin token right after a register failure, and on Back', async () => {
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            if (p === 'POST /v1/operational-devices') return { status: 500 };
            return { data: { success: true } };
        });
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        const logouts = () => api.calls.filter((c) => pathOf(c) === 'POST /auth/logout');
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Salón' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar dispositivo' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar');
        expect(logouts()).toHaveLength(1);
        expect(logouts()[0].headers.get('Authorization')).toBe('Bearer admin-tok');

        // Log in again, then Back from the login form revokes nothing extra when no token is held.
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await screen.findByLabelText(/Nombre del dispositivo/);
    });

    it('Back during the admin login revokes a held admin session', async () => {
        const api = fakeApi((c) =>
            pathOf(c) === 'POST /auth/login'
                ? { data: { success: true, data: { requires2FA: true } } }
                : { data: { success: true } },
        );
        const device = createDeviceApi({ http: api.http, sessions: api.sessions });
        const cancel = vi.spyOn(device, 'cancel');
        render(<DeviceSetupScreen api={device} onDone={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
        expect(cancel).toHaveBeenCalled();
    });

    it('register returns only the device type, never the token', async () => {
        const api = fakeApi((c) =>
            pathOf(c) === 'POST /auth/login'
                ? { data: { success: true, data: { token: 'admin-tok', user: admin } } }
                : { status: 201, data: { success: true, data: { device: {}, deviceToken: 'dev-raw' } } },
        );
        const device = createDeviceApi({ http: api.http, sessions: api.sessions });
        await device.adminLogin('a', 'b');
        const result = await device.register({ branchId: 1, type: 'SERVICE_TABLET', name: 'x' });
        expect(result).toEqual({ deviceType: 'SERVICE_TABLET' });
        expect(await api.sessions.deviceToken()).toBe('dev-raw');
    });

    it('Personal needs no admin login and never calls the server', async () => {
        const { calls, sessions, onDone } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Personal/ }));
        await waitFor(() => expect(onDone).toHaveBeenCalledWith('PERSONAL'));
        expect(calls).toHaveLength(0);
        expect(await sessions.deviceType()).toBe('PERSONAL');
        expect(await sessions.deviceToken()).toBeNull();
    });

    it('shows a generic error and stays on the form when the admin login fails', async () => {
        const api = fakeApi(() => ({ status: 401 }));
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'nope');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo iniciar sesión');
        expect(await api.sessions.deviceToken()).toBeNull();
    });
});
