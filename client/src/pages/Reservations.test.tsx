// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { upcoming, rows } = vi.hoisted(() => { const future = (h: number) => new Date(Date.now() + h * 3600000).toISOString(); return { upcoming: vi.fn(), rows: [
    { id: 1, customerName: 'Luis Pérez', phone: '8888', date: future(2), peopleCount: 4, status: 'CONFIRMED', branchId: 1, table: { id: 9, number: '9', capacity: 4 } },
    { id: 2, customerName: 'Marta Gómez', phone: '7777', date: future(30), peopleCount: 2, status: 'PENDING', branchId: 1, table: null },
] }; });
vi.mock('../services/api', () => ({
    reservationsAPI: {
        getAll: vi.fn().mockResolvedValue({ data: { data: rows } }),
        getUpcoming: (...a: unknown[]) => upcoming(...a),
    },
    branchesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 1, name: 'Centro' }] } }) },
    tablesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 9, number: '9', status: 'OCCUPIED', branchId: 1 }] } }) },
}));
const auth = vi.hoisted(() => ({ user: { id: 1, branchId: 1, roles: [{ name: 'ADMIN' }], role: { name: 'ADMIN' } } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => toast }));
const confirmCtx = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirmDialog: () => confirmCtx }));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ symbol: 'C$', formatMoney: (n: number) => String(n) }) }));

import Reservations from './Reservations';

describe('Reservations (design system)', () => {
    it('usa PageHeader, DataTable y la tarjeta de próxima reserva con la mesa que debe liberarse', async () => {
        upcoming.mockResolvedValue({ data: { data: rows } });
        render(<Reservations />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Reservaciones' })).toBeInTheDocument();
        const table = await screen.findByRole('table', { name: 'Reservaciones' });
        expect(within(table).getByText('Luis Pérez')).toBeInTheDocument();
        const card = await screen.findByRole('region', { name: 'Próxima reserva' });
        expect(card).toHaveTextContent('Luis Pérez');
        expect(await within(card).findByText(/sigue ocupada: debe liberarse/)).toBeInTheDocument();
    });

    it('muestra N/D (no 0) si la próxima reserva no se pudo cargar', async () => {
        upcoming.mockRejectedValue(new Error('down'));
        render(<Reservations />);
        const card = await screen.findByRole('region', { name: 'Próxima reserva' });
        await within(card).findByText('N/D');
        expect(card).toHaveTextContent('No disponible');
    });

    it('abre el formulario en FullScreenModal con pestañas', async () => {
        upcoming.mockResolvedValue({ data: { data: [] } });
        render(<Reservations />);
        await userEvent.click(await screen.findByRole('button', { name: /Nueva reservación/ }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Reserva' })).toBeInTheDocument();
    });
});
