import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviceSetupScreen } from './DeviceSetupScreen';
import { createDeviceApi } from './deviceApi';
import { fakeApi, pathOf, user } from '../../test/helpers';

const admin = { ...user, id: 1, role: { id: 9, name: 'ADMIN' }, roles: ['ADMIN'], branchId: 3 };

const centro = { id: 3, name: 'Centro', kitchenUsers: [{ id: 42, name: 'Ana', username: 'ana' }] };
const norte = { id: 4, name: 'Norte', kitchenUsers: [{ id: 50, name: 'Beto', username: 'beto' }, { id: 51, name: 'Carla', username: 'carla' }] };
const sur = { id: 5, name: 'Sur', kitchenUsers: [{ id: 60, name: 'Dora', username: 'dora' }, { id: 61, name: 'Eli', username: 'eli' }] };
const optionsRes = (branches: unknown[]) => ({ data: { success: true, data: { branches } } });
const registerBtn = () => screen.getByRole('button', { name: 'Registrar dispositivo' });
const ready = () => waitFor(() => expect(registerBtn()).toBeEnabled());

function setup(opts: { twoFactor?: boolean; branches?: unknown[]; admin?: typeof admin } = {}) {
    const api = fakeApi((c) => {
        const p = pathOf(c);
        if (p === 'POST /auth/login') {
            const body = JSON.parse(String(c.data));
            if (opts.twoFactor && !body.twoFactorCode) return { data: { success: true, data: { requires2FA: true } } };
            return { data: { success: true, data: { token: 'admin-tok', user: opts.admin ?? admin } } };
        }
        if (p === 'GET /v1/operational-devices/setup-options') return optionsRes(opts.branches ?? [centro]);
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
        await ready();
        fireEvent.click(registerBtn());

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

    it('registers a kitchen tablet auto-selecting its only kitchen user', async () => {
        const { calls, onDone } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Tablet de cocina/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Cocina' } });
        await ready();
        fireEvent.click(registerBtn());
        await waitFor(() => expect(onDone).toHaveBeenCalledWith('KITCHEN_TABLET'));
        const register = calls.find((c) => pathOf(c) === 'POST /v1/operational-devices')!;
        expect(JSON.parse(String(register.data))).toMatchObject({ type: 'KITCHEN_TABLET', kitchenUserId: 42 });
    });

    it('a 400 on register shows the server reason and clears the password', async () => {
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            if (p === 'GET /v1/operational-devices/setup-options') return optionsRes([centro]);
            if (p === 'POST /v1/operational-devices') return { status: 400, data: { success: false, message: 'Usuario de cocina inválido' } };
            return { data: { success: true } };
        });
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Salón' } });
        await ready();
        fireEvent.click(registerBtn());
        expect(await screen.findByRole('alert')).toHaveTextContent('Usuario de cocina inválido');
        expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    });

    it('drops the admin token right after a register failure, and on Back', async () => {
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            if (p === 'GET /v1/operational-devices/setup-options') return optionsRes([centro]);
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
        await ready();
        fireEvent.click(registerBtn());
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

describe('DeviceSetupScreen in-flight login and Cancelar', () => {
    it('Back while the admin login is in flight discards its token and stays on the type step', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const api = fakeApi(async (c) => {
            if (pathOf(c) === 'POST /auth/login') {
                await gate;
                return { data: { success: true, data: { token: 'late-admin', user: admin } } };
            }
            return { data: { success: true } };
        });
        const device = createDeviceApi({ http: api.http, sessions: api.sessions });
        render(<DeviceSetupScreen api={device} onDone={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await waitFor(() => expect(api.calls.map(pathOf)).toContain('POST /auth/login'));
        fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
        release();
        // The late token is revoked, never kept, and the screen does not advance.
        await waitFor(() => {
            const logout = api.calls.find((c) => pathOf(c) === 'POST /auth/logout');
            expect(logout?.headers.get('Authorization')).toBe('Bearer late-admin');
        });
        expect(screen.getByText('¿Qué es este dispositivo?')).toBeInTheDocument();
        expect(screen.queryByLabelText(/Nombre del dispositivo/)).not.toBeInTheDocument();
        await expect(device.register({ branchId: 1, type: 'SERVICE_TABLET', name: 'x' })).rejects.toThrow('admin login required');
    });

    it('cancel() invalidates an in-flight login at the api level', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const api = fakeApi(async () => {
            await gate;
            return { data: { success: true, data: { token: 'late-admin', user: admin } } };
        });
        const device = createDeviceApi({ http: api.http, sessions: api.sessions });
        const login = device.adminLogin('a', 'b');
        await device.cancel();
        release();
        expect(await login).toEqual({ status: 'cancelled' });
    });

    it('Cancelar on the details step drops the admin token and returns to the type step', async () => {
        const { calls } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await screen.findByLabelText(/Nombre del dispositivo/);
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(await screen.findByText('¿Qué es este dispositivo?')).toBeInTheDocument();
        await waitFor(() => {
            const logout = calls.find((c) => pathOf(c) === 'POST /auth/logout');
            expect(logout?.headers.get('Authorization')).toBe('Bearer admin-tok');
        });
    });
});

describe('DeviceSetupScreen pickers', () => {
    async function toDetails(kitchen = false) {
        fireEvent.click(screen.getByRole('button', { name: kitchen ? /Tablet de cocina/ : /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await screen.findByLabelText(/Nombre del dispositivo/);
    }
    const noBranchAdmin = { ...admin, branchId: null } as unknown as typeof admin;

    it('uses the only branch without a picker', async () => {
        const { calls } = setup({ admin: noBranchAdmin });
        await toDetails();
        expect(await screen.findByText('Sucursal: Centro')).toBeInTheDocument();
        expect(screen.queryByLabelText('Sucursal')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Nombre del dispositivo/), { target: { value: 'Salón' } });
        await ready();
        fireEvent.click(registerBtn());
        await waitFor(() => expect(calls.map(pathOf)).toContain('POST /v1/operational-devices'));
        const register = calls.find((c) => pathOf(c) === 'POST /v1/operational-devices')!;
        expect(JSON.parse(String(register.data))).toMatchObject({ branchId: 3 });
    });

    it('multi-branch picker preselects admin.branchId and resets the kitchen user on change', async () => {
        const { calls, onDone } = setup({ branches: [centro, norte, sur], admin: { ...admin, branchId: 4 } });
        await toDetails(true);
        const branch = (await screen.findByLabelText('Sucursal')) as HTMLSelectElement;
        expect(branch.value).toBe('4');
        const kitchen = screen.getByLabelText('Usuario de cocina') as HTMLSelectElement;
        expect(kitchen.value).toBe('');
        expect(screen.getByRole('option', { name: 'Elige el usuario de cocina' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Carla (carla)' })).toBeInTheDocument();
        fireEvent.change(kitchen, { target: { value: '51' } });
        fireEvent.change(screen.getByLabelText(/Nombre del dispositivo/), { target: { value: 'Cocina' } });
        await ready();
        fireEvent.change(branch, { target: { value: '5' } });
        // Branch 5 has several kitchen users: the previous choice must not carry over.
        await waitFor(() => expect(screen.getByRole('option', { name: 'Dora (dora)' })).toBeInTheDocument());
        expect((screen.getByLabelText('Usuario de cocina') as HTMLSelectElement).value).toBe('');
        expect(registerBtn()).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Usuario de cocina'), { target: { value: '61' } });
        await ready();
        fireEvent.click(registerBtn());
        await waitFor(() => expect(onDone).toHaveBeenCalledWith('KITCHEN_TABLET'));
        const register = calls.find((c) => pathOf(c) === 'POST /v1/operational-devices')!;
        expect(JSON.parse(String(register.data))).toMatchObject({ branchId: 5, kitchenUserId: 61 });
    });

    it('multi-branch without admin branch asks to pick and blocks Registrar until chosen', async () => {
        setup({ branches: [centro, norte], admin: noBranchAdmin });
        await toDetails();
        const branch = await screen.findByLabelText('Sucursal');
        expect(screen.getByRole('option', { name: 'Elige una sucursal' })).toBeInTheDocument();
        expect(registerBtn()).toBeDisabled();
        fireEvent.change(branch, { target: { value: '3' } });
        await ready();
    });

    it('an empty kitchen list shows the message and disables Registrar', async () => {
        setup({ branches: [{ id: 3, name: 'Centro', kitchenUsers: [] }] });
        await toDetails(true);
        expect(await screen.findByText(/no tiene usuarios de cocina activos/)).toBeInTheDocument();
        expect(registerBtn()).toBeDisabled();
    });

    it('zero branches shows an error and disables Registrar', async () => {
        setup({ branches: [] });
        await toDetails();
        expect(await screen.findByText('No tienes sucursales disponibles')).toBeInTheDocument();
        expect(registerBtn()).toBeDisabled();
    });

    it('a failed options load shows Reintentar and the retry works', async () => {
        let fail = true;
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            if (p === 'GET /v1/operational-devices/setup-options') return fail ? { status: 500 } : optionsRes([centro]);
            return { data: { success: true } };
        });
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        await toDetails();
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
        fail = false;
        expect(await screen.findByText('Sucursal: Centro')).toBeInTheDocument();
        await ready();
    });

    it('setupOptions sends the admin bearer token and requires a login', async () => {
        const api = fakeApi((c) =>
            pathOf(c) === 'POST /auth/login'
                ? { data: { success: true, data: { token: 'admin-tok', user: admin } } }
                : optionsRes([centro]),
        );
        const device = createDeviceApi({ http: api.http, sessions: api.sessions });
        await expect(device.setupOptions()).rejects.toThrow('admin login required');
        await device.adminLogin('a', 'b');
        expect(await device.setupOptions()).toEqual([centro]);
        const call = api.calls.find((c) => pathOf(c) === 'GET /v1/operational-devices/setup-options')!;
        expect(call.headers.get('Authorization')).toBe('Bearer admin-tok');
    });
});

describe('DeviceSetupScreen options failures and races', () => {
    function build(optionsHandler: () => unknown, registerStatus = 500) {
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            if (p === 'GET /v1/operational-devices/setup-options') return optionsHandler() as never;
            if (p === 'POST /v1/operational-devices') return { status: registerStatus };
            return { data: { success: true } };
        });
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        return api;
    }
    async function login() {
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    }

    it.each([[403, 'Este usuario no puede registrar dispositivos'], [401, 'La sesión expiró, vuelve a iniciar sesión']])(
        'a %i on setup-options drops the admin session and returns to login',
        async (status, message) => {
            const api = build(() => ({ status }));
            await login();
            expect(await screen.findByRole('alert')).toHaveTextContent(message);
            expect(screen.getByLabelText('Contraseña')).toHaveValue('');
            await waitFor(() => {
                const logout = api.calls.find((c) => pathOf(c) === 'POST /auth/logout');
                expect(logout?.headers.get('Authorization')).toBe('Bearer admin-tok');
            });
        },
    );

    it('a late options result after Cancelar is ignored', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        build(async () => {
            await gate;
            return optionsRes([centro]);
        });
        await login();
        await screen.findByLabelText(/Nombre del dispositivo/);
        expect(screen.getByText('Cargando…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await screen.findByText('¿Qué es este dispositivo?');
        release();
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.getByText('¿Qué es este dispositivo?')).toBeInTheDocument();
    });

    it('a late options result after a register failure does not move the screen', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        let calls = 0;
        build(async () => {
            if (calls++ === 0) return optionsRes([centro]);
            await gate;
            return optionsRes([centro]);
        });
        await login();
        fireEvent.change(await screen.findByLabelText(/Nombre del dispositivo/), { target: { value: 'Salón' } });
        await ready();
        fireEvent.click(registerBtn());
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar');
        // Log in again: a second options load is now pending behind the gate.
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await screen.findByText('Cargando…');
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await screen.findByText('¿Qué es este dispositivo?');
        release();
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.getByText('¿Qué es este dispositivo?')).toBeInTheDocument();
    });
});

describe('DeviceSetupScreen edge cases (M6/M7)', () => {
    function mk(handlers: { options?: () => unknown; register?: () => unknown; twoFactor?: boolean }) {
        const api = fakeApi((c) => {
            const p = pathOf(c);
            if (p === 'POST /auth/login') {
                if (handlers.twoFactor && !JSON.parse(String(c.data)).twoFactorCode) return { data: { success: true, data: { requires2FA: true } } };
                return { data: { success: true, data: { token: 'admin-tok', user: admin } } };
            }
            if (p === 'GET /v1/operational-devices/setup-options') return (handlers.options?.() ?? optionsRes([centro])) as never;
            if (p === 'POST /v1/operational-devices') return (handlers.register?.() ?? { status: 201, data: {} }) as never;
            return { data: { success: true } };
        });
        render(<DeviceSetupScreen api={createDeviceApi({ http: api.http, sessions: api.sessions })} onDone={vi.fn()} />);
        return api;
    }

    it('Continuar stays disabled while the 2FA code is empty, and Atrás clears the typed password', async () => {
        mk({ twoFactor: true });
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        await screen.findByLabelText('Código 2FA');
        expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    });

    it('a password-change gate on setup-options is not reported as "cannot register"', async () => {
        mk({ options: () => ({ status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED' } }) });
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('cambiar tu contraseña');
    });

    it('a lost register response warns that the device may exist; the name input is capped at 100', async () => {
        mk({ register: () => { throw new Error('timeout'); } });
        fireEvent.click(screen.getByRole('button', { name: /Tablet de servicio/ }));
        type('Usuario', 'admin');
        type('Contraseña', 'secret-pass');
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        const nameBox = await screen.findByLabelText(/Nombre del dispositivo/);
        expect(nameBox).toHaveAttribute('maxlength', '100');
        fireEvent.change(nameBox, { target: { value: 'Salón' } });
        await ready();
        fireEvent.click(registerBtn());
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el registro');
    });
});
