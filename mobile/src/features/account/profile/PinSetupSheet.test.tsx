import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HrError } from '../hrApi';
import { PinSetupSheet, validatePin } from './PinSetupSheet';

describe('validatePin', () => {
    it.each(['2580', '1357', '246802', '258036'])('accepts %s', (pin) => expect(validatePin(pin)).toBeNull());
    it.each(['123', '12345a', '1234567', ''])('rejects length/format %s', (pin) => expect(validatePin(pin)).toBe('El PIN debe tener entre 4 y 6 dígitos'));
    it.each(['1111', '777777', '4321', '654321', '1234', '123456'])('rejects easy %s', (pin) => expect(validatePin(pin)).toBe('El PIN es demasiado fácil de adivinar'));
});

describe('PinSetupSheet', () => {
    function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
        render(<PinSetupSheet hasPin={false} onSubmit={onSubmit} onClose={vi.fn()} />);
        const fill = (a: string, b: string) => {
            fireEvent.change(screen.getByLabelText('PIN'), { target: { value: a } });
            fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: b } });
            fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'pw' } });
            fireEvent.click(screen.getByRole('button', { name: 'Guardar PIN' }));
        };
        return { onSubmit, fill };
    }

    it.each(['2580', '258036'])('accepts the %s boundary', async (pin) => {
        const { onSubmit, fill } = setup();
        fill(pin, pin);
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(pin, 'pw'));
    });

    it('a 7th digit is dropped by the input, so at most 6 are ever sent', async () => {
        const { onSubmit, fill } = setup();
        fill('2580369', '2580369');
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('258036', 'pw'));
    });

    it('a 401 shows "Contraseña actual incorrecta" and keeps the sheet usable', async () => {
        const { fill } = setup(vi.fn().mockRejectedValue(new HrError('Credenciales inválidas', { status: 401, isAmbiguous: false })));
        fill('2580', '2580');
        expect(await screen.findByText('Contraseña actual incorrecta')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar PIN' })).not.toBeDisabled();
    });

    it('rejects a descending run and repeated digits without submitting', () => {
        const { onSubmit, fill } = setup();
        fill('4321', '4321');
        expect(screen.getByText('El PIN es demasiado fácil de adivinar')).toBeInTheDocument();
        fill('9999', '9999');
        expect(screen.getByText('El PIN es demasiado fácil de adivinar')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
