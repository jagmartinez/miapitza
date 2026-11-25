// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAll = vi.fn();
vi.mock('../services/api', () => ({
    ordersAPI: { getAll: (...a: unknown[]) => getAll(...a), getById: vi.fn() },
    invoicesAPI: {},
    cashShiftsAPI: { getActiveStatus: vi.fn().mockResolvedValue({ data: { data: { hasActiveShift: false, requiresClose: false } } }) },
    warehousesAPI: { getAll: vi.fn() },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, roles: [{ name: 'ADMIN' }], role: { name: 'ADMIN' } } }) }));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ symbol: 'C$', formatMoney: (n: number) => `C$ ${n.toFixed(2)}` }) }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock('../utils/websocket', () => ({
    initializeWebSocket: vi.fn(),
    subscribeWebSocket: () => () => undefined,
    WS_EVENTS: {},
}));
vi.mock('../components/PaymentModal', () => ({ default: () => null }));

import Orders from './Orders';

const order = (id: number, total: number, extra: Record<string, unknown> = {}) => ({
    id,
    branchId: 1,
    total,
    status: 'OPEN',
    financialStatus: 'UNPAID',
    createdAt: new Date().toISOString(),
    items: [{ id: id * 10, menuItemId: 1, quantity: 1, subtotal: total, menuItem: { name: 'Pizza' } }],
    user: { name: 'Ana' },
    ...extra,
});

describe('Orders (design system)', () => {
    beforeEach(() => {
        getAll.mockReset();
    });

    it('usa PageHeader, DataTable con total alineado a la derecha y formato 1,234.50', async () => {
        getAll.mockResolvedValue({ data: { data: [order(1, 1234.5), order(2, 10, { status: 'CANCELLED' })] } });
        render(<Orders />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Gestión de órdenes' })).toBeInTheDocument();
        const table = await screen.findByRole('table', { name: 'Órdenes' });
        expect(within(table).getByText('1,234.50')).toBeInTheDocument();
        expect(within(table).getByText('1,234.50').closest('td')).toHaveClass('ui-cell--numeric');
        expect(within(table).getAllByRole('columnheader').some((h) => h.textContent === 'Total (C$)')).toBe(true);
    });

    it('filtra por estado con el control segmentado', async () => {
        getAll.mockResolvedValue({ data: { data: [order(1, 100), order(2, 50, { status: 'CANCELLED' })] } });
        render(<Orders />);
        await screen.findByRole('table', { name: 'Órdenes' });
        await userEvent.click(screen.getByRole('button', { name: 'Cancelada' }));
        const table = screen.getByRole('table', { name: 'Órdenes' });
        expect(within(table).queryByText('#1')).toBeNull();
        expect(within(table).getByText('#2')).toBeInTheDocument();
    });

    it('avisa y permite reintentar cuando la carga falla', async () => {
        getAll.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ data: { data: [order(3, 5)] } });
        render(<Orders />);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('No se pudieron cargar las órdenes');
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        expect(screen.getByText('#3')).toBeInTheDocument();
    });

    it('abre el detalle en FullScreenModal al elegir una fila', async () => {
        getAll.mockResolvedValue({ data: { data: [order(7, 20)] } });
        render(<Orders />);
        await userEvent.click(await screen.findByText('#7'));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Productos/ })).toBeInTheDocument();
    });
});
