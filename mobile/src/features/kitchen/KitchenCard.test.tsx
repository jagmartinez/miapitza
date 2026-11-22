import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KitchenCard } from './KitchenCard';
import type { KitchenBatch } from './kitchenTypes';

const NOW = new Date('2026-11-21T10:10:00.000Z').getTime();
const mk = (over: Partial<KitchenBatch> = {}): KitchenBatch => ({
    id: 5,
    kitchenBatchId: 2,
    status: 'SENT_TO_KITCHEN',
    table: { number: 4 },
    user: { id: 1, name: 'Ana' },
    orderType: 'DINE_IN',
    createdAt: '2026-11-21T09:00:00.000Z',
    items: [{ id: 1, quantity: 2, sentAt: '2026-11-21T10:05:00.000Z', menuItem: { name: 'Pizza' }, modifiers: [{ name: 'Extra queso' }], notes: 'sin cebolla' }],
    ...over,
});
const config = { warningMinutes: 5, urgentMinutes: 10 };
const base = { config, now: NOW, canManage: true, starting: false, onStart: vi.fn(), onReady: vi.fn() };

describe('KitchenCard', () => {
    it('shows table, waiter, minutes, lines, notes', () => {
        render(<KitchenCard batch={mk({ kitchenBatchSequence: 2 })} {...base} />);
        expect(screen.getByText('M4')).toBeInTheDocument();
        expect(screen.getByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('5 min')).toBeInTheDocument();
        expect(screen.getByText('2 × Pizza')).toBeInTheDocument();
        expect(screen.getByText('Extra queso')).toBeInTheDocument();
        expect(screen.getByText('sin cebolla')).toBeInTheDocument();
        expect(screen.getByText('Tanda 2')).toBeInTheDocument();
    });

    it('warning/urgent classes from thresholds', () => {
        const { rerender } = render(<KitchenCard batch={mk()} {...base} />);
        expect(screen.getByTestId('kitchen-card')).toHaveClass('time-warning');
        rerender(<KitchenCard batch={mk()} {...base} now={NOW + 6 * 60_000} />);
        expect(screen.getByTestId('kitchen-card')).toHaveClass('time-urgent');
        rerender(<KitchenCard batch={mk()} {...base} now={NOW - 4 * 60_000} />);
        expect(screen.getByTestId('kitchen-card')).toHaveClass('time-normal');
    });

    it('Iniciar for PENDING, Listo for IN_PREPARATION and READY', () => {
        const { rerender } = render(<KitchenCard batch={mk()} {...base} />);
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
        expect(base.onStart).toHaveBeenCalledTimes(1);
        rerender(<KitchenCard batch={mk({ status: 'IN_PREPARATION' })} {...base} />);
        fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
        expect(base.onReady).toHaveBeenCalledTimes(1);
        rerender(<KitchenCard batch={mk({ status: 'READY' })} {...base} />);
        expect(screen.getByRole('button', { name: 'Listo' })).toBeEnabled();
        expect(screen.getByTestId('kitchen-card')).toHaveClass('is-ready');
    });

    it('shows Iniciando… while starting', () => {
        render(<KitchenCard batch={mk()} {...base} starting />);
        expect(screen.getByRole('button', { name: 'Iniciando…' })).toBeDisabled();
    });

    it('disabled with reason without kds.manage', () => {
        render(<KitchenCard batch={mk()} {...base} canManage={false} />);
        expect(screen.getByRole('button', { name: 'Iniciar' })).toBeDisabled();
        expect(screen.getByText('Sin permiso para marcar')).toBeInTheDocument();
    });
});
