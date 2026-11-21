import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AccountApp from './AccountApp';
import { fakeApi, session } from '../../test/helpers';
import type { Services } from '../../core/services';

describe('AccountApp', () => {
    it('opens a section placeholder and goes back to the home', async () => {
        const { http } = fakeApi((c) => {
            if (String(c.url).includes('loan-policy')) return { data: { data: { currency: 'USD', maxAmount: '10', eligible: true } } };
            return { data: { data: [] } };
        });
        const linked = { ...session, user: { ...session.user, employeeId: 3 } };
        render(<AccountApp session={linked} services={{ http } as unknown as Services} onLogout={vi.fn()} />);
        fireEvent.click(await screen.findByText('Mi horario'));
        expect(screen.getByRole('heading', { name: 'Mi horario' })).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Volver'));
        expect(await screen.findByText('Solicitar')).toBeInTheDocument();
    });
});
