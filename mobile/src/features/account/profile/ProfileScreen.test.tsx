import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountNavProvider } from '../AccountNav';
import { ToastProvider } from '../../../ui/Toast';
import type { HrApi } from '../hrApi';
import { ProfileScreen } from './ProfileScreen';

const employee = { code: 'E-01', fullName: 'Ana Pérez', position: 'Mesera', branchName: 'Matriz', hireDate: '2025-01-10', workEmail: null, workPhone: null, emergencyContactName: 'Luis', emergencyContactPhone: '555' };

function mount(over: Record<string, unknown> = {}) {
    const hr = {
        myEmployee: vi.fn(async () => employee),
        profile: vi.fn(async () => ({ name: 'Ana', email: 'a@x.com', phone: '111', address: 'Calle 1', color: '#fff' })),
        updateProfile: vi.fn(async (b: unknown) => b),
        authMe: vi.fn(async () => ({ hasPin: false, canUsePin: true })),
        setPin: vi.fn(async () => ({})),
        ...over,
    };
    const onLogout = vi.fn();
    render(
        <ToastProvider>
            <AccountNavProvider>
                <ProfileScreen hr={hr as unknown as HrApi} accountApi={{ changePassword: vi.fn() }} onPasswordChanged={vi.fn()} onLogout={onLogout} />
            </AccountNavProvider>
        </ToastProvider>,
    );
    return { hr, onLogout };
}

describe('ProfileScreen', () => {
    it('shows the employee summary and logs out', async () => {
        const { onLogout } = mount();
        expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
        expect(screen.getByText('Mesera')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        expect(onLogout).toHaveBeenCalled();
    });

    it('profile save sends only whitelisted fields', async () => {
        const { hr } = mount();
        const phone = await screen.findByLabelText('Teléfono');
        fireEvent.change(phone, { target: { value: '222' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(hr.updateProfile).toHaveBeenCalledTimes(1));
        expect(hr.updateProfile).toHaveBeenCalledWith({ phone: '222', email: 'a@x.com', address: 'Calle 1' });
    });

    it('PIN option hidden when canUsePin false', async () => {
        mount({ authMe: vi.fn(async () => ({ hasPin: false, canUsePin: false })) });
        await screen.findByText('Ana Pérez');
        expect(screen.queryByRole('button', { name: /PIN/ })).toBeNull();
    });

    it('PIN label follows hasPin', async () => {
        mount({ authMe: vi.fn(async () => ({ hasPin: true, canUsePin: true })) });
        expect(await screen.findByRole('button', { name: 'Cambiar PIN' })).toBeInTheDocument();
    });

    it('PIN sheet sends currentPassword and validates match', async () => {
        const { hr } = mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Definir PIN' }));
        const fill = (a: string, b: string, c: string) => {
            fireEvent.change(screen.getByLabelText('PIN'), { target: { value: a } });
            fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: b } });
            fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: c } });
        };
        const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar PIN' }));
        fill('2580', '2581', 'pw');
        save();
        expect(screen.getByText('Los PIN no coinciden')).toBeInTheDocument();
        fill('1111', '1111', 'pw');
        save();
        expect(screen.getByText('El PIN es demasiado fácil de adivinar')).toBeInTheDocument();
        fill('1234', '1234', 'pw');
        save();
        expect(screen.getByText('El PIN es demasiado fácil de adivinar')).toBeInTheDocument();
        fill('12', '12', 'pw');
        save();
        expect(screen.getByText('El PIN debe tener entre 4 y 6 dígitos')).toBeInTheDocument();
        expect(hr.setPin).not.toHaveBeenCalled();
        fill('2580', '2580', 'pw');
        save();
        await waitFor(() => expect(hr.setPin).toHaveBeenCalledWith('2580', 'pw'));
        expect(await screen.findByRole('button', { name: 'Cambiar PIN' })).toBeInTheDocument();
    });

    it('PIN sheet shows the server message and keeps the sheet', async () => {
        const err = Object.assign(new Error('x'), { response: { status: 401, data: { message: 'Credenciales inválidas' } } });
        mount({ setPin: vi.fn().mockRejectedValue(err) });
        fireEvent.click(await screen.findByRole('button', { name: 'Definir PIN' }));
        fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2580' } });
        fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: '2580' } });
        fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'bad' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar PIN' }));
        expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    });

    it('Cambiar contraseña opens the non-blocking screen with a back button', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Cambiar contraseña' }));
        expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
        fireEvent.click(screen.getByLabelText('Volver'));
        expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    });
});
