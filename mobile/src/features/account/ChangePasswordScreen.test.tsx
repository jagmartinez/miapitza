import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangePasswordScreen } from './ChangePasswordScreen';

function setup(changePassword = vi.fn().mockResolvedValue(undefined)) {
    const onChanged = vi.fn();
    const onLogout = vi.fn();
    render(<ChangePasswordScreen api={{ changePassword }} onChanged={onChanged} onLogout={onLogout} />);
    const fill = (a: string, b: string, c: string) => {
        fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: a } });
        fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: b } });
        fireEvent.change(screen.getByLabelText('Repite la nueva contraseña'), { target: { value: c } });
    };
    return { changePassword, onChanged, onLogout, fill };
}

describe('ChangePasswordScreen', () => {
    it('is blocking: no back button, Cerrar sesión is available', () => {
        setup();
        expect(screen.queryByRole('button', { name: /atrás|volver|cancelar/i })).toBeNull();
        expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    });

    it('mismatch is rejected without calling the server', () => {
        const { changePassword, fill } = setup();
        fill('old', 'newpassword1', 'newpassword2');
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
        expect(changePassword).not.toHaveBeenCalled();
    });

    it('length 8-128 is validated', () => {
        const { changePassword, fill } = setup();
        fill('old', 'short', 'short');
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        expect(screen.getByText('La contraseña debe tener entre 8 y 128 caracteres')).toBeInTheDocument();
        fill('old', 'x'.repeat(129), 'x'.repeat(129));
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        expect(screen.getByText('La contraseña debe tener entre 8 y 128 caracteres')).toBeInTheDocument();
        expect(changePassword).not.toHaveBeenCalled();
    });

    it('success calls onChanged', async () => {
        const { changePassword, onChanged, fill } = setup();
        fill('old', 'newpassword1', 'newpassword1');
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(changePassword).toHaveBeenCalledWith('old', 'newpassword1');
    });

    it('shows the server message on failure', async () => {
        const err = Object.assign(new Error('x'), { response: { status: 400, data: { message: 'Contraseña actual incorrecta' } } });
        const { onChanged, fill } = setup(vi.fn().mockRejectedValue(err));
        fill('old', 'newpassword1', 'newpassword1');
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        expect(await screen.findByText('Contraseña actual incorrecta')).toBeInTheDocument();
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('Cerrar sesión calls onLogout', () => {
        const { onLogout } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        expect(onLogout).toHaveBeenCalled();
    });
});
