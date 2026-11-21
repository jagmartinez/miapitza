import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadyToasts, type ActionFailure } from './ReadyToasts';
import type { PendingReady } from './useReadyCommit';

const pend = (n: number, deadline = Date.now() + 5000 + n): PendingReady => ({ key: `${n}:1`, label: `M${n}`, waiter: 'Ana', deadline });
const fail = (n: number, action: 'start' | 'ready' = 'ready'): ActionFailure => ({ key: `${n}:1`, label: `M${n}`, message: 'boom', action });

describe('ReadyToasts', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('card row height is unchanged when a toast appears (band always rendered)', () => {
        const { rerender } = render(<ReadyToasts pending={[]} failures={[]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        const band = screen.getByTestId('kitchen-toasts');
        expect(band).toBeInTheDocument();
        expect(band.children).toHaveLength(0);
        rerender(<ReadyToasts pending={[pend(1)]} failures={[]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.getByTestId('kitchen-toasts')).toBe(band);
        expect(screen.getByText(/M1 lista/)).toBeInTheDocument();
    });

    it('three failures never hide a pending undo toast', () => {
        render(<ReadyToasts pending={[pend(9)]} failures={[fail(1), fail(2), fail(3)]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Deshacer/ })).toBeInTheDocument();
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('shows the 2 newest pending toasts plus a +n chip', () => {
        const now = Date.now();
        render(<ReadyToasts pending={[pend(1, now + 1000), pend(2, now + 2000), pend(3, now + 3000), pend(4, now + 4000)]} failures={[]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.getAllByRole('button', { name: /Deshacer/ })).toHaveLength(2);
        expect(screen.getByText(/M4 lista/)).toBeInTheDocument();
        expect(screen.getByText(/M3 lista/)).toBeInTheDocument();
        expect(screen.queryByText(/M1 lista/)).not.toBeInTheDocument();
        expect(screen.getByText('+2')).toBeInTheDocument();
    });

    it('failure toast auto-dismisses after 8 s and stays dismissable', () => {
        const onDismiss = vi.fn();
        render(<ReadyToasts pending={[]} failures={[fail(1)]} onUndo={vi.fn()} onDismiss={onDismiss} />);
        act(() => { vi.advanceTimersByTime(7_999); });
        expect(onDismiss).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(onDismiss).toHaveBeenCalledWith('1:1');
        onDismiss.mockClear();
        act(() => { vi.advanceTimersByTime(1); });
        expect(onDismiss).toHaveBeenCalledWith('1:1');
    });

    it('failure copy depends on the action', () => {
        render(<ReadyToasts pending={[]} failures={[fail(1, 'start')]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.getByText('No se pudo iniciar M1: boom')).toBeInTheDocument();
    });

    it('ready failure copy and Comanda fallback', () => {
        render(<ReadyToasts pending={[]} failures={[{ ...fail(1), label: '' }]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.getByText('No se pudo marcar Comanda: boom')).toBeInTheDocument();
    });
});
