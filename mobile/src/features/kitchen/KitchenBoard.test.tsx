import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appEvents } from '../../core/events';
import { KitchenActionError } from './kitchenApi';
import { KitchenBoard } from './KitchenBoard';
import { playKitchenChime } from './kitchenSound';
import type { KitchenBatch } from './kitchenTypes';

vi.mock('./kitchenSound', () => ({ playKitchenChime: vi.fn() }));

const mk = (id: number, over: Partial<KitchenBatch> = {}): KitchenBatch => ({
    id,
    kitchenBatchId: 1,
    status: 'IN_PREPARATION',
    table: { number: id },
    user: { id: 1, name: 'Ana' },
    orderType: 'DINE_IN',
    createdAt: new Date().toISOString(),
    items: [{ id: id * 10, quantity: 1, sentAt: new Date().toISOString(), menuItem: { name: 'Taco' } }],
    ...over,
});

type Handler = (payload: unknown) => void;
function fakeRealtime() {
    const subs = new Map<string, Set<Handler>>();
    return {
        subscribe(type: string, fn: Handler) {
            if (!subs.has(type)) subs.set(type, new Set());
            subs.get(type)!.add(fn);
            return () => subs.get(type)!.delete(fn);
        },
        emit(type: string) {
            [...(subs.get(type) ?? [])].forEach((fn) => fn({}));
        },
    };
}

function setup(over: { queue?: () => Promise<KitchenBatch[]>; recent?: KitchenBatch[]; canManage?: boolean; start?: () => Promise<void>; undoMs?: number } = {}) {
    const api = {
        queue: vi.fn(over.queue ?? (async () => [mk(1), mk(2)])),
        config: vi.fn(async () => ({ warningMinutes: 5, urgentMinutes: 10 })),
        recent: vi.fn(async () => over.recent ?? []),
        start: vi.fn(over.start ?? (async () => {})),
        ready: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
    };
    const realtime = fakeRealtime();
    const utils = render(<KitchenBoard api={api as never} realtime={realtime} canManage={over.canManage ?? true} connection="online" undoMs={over.undoMs ?? 60_000} />);
    return { api, realtime, ...utils };
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(playKitchenChime).mockClear();
});

describe('KitchenBoard', () => {
    it('shows loading, then the empty state', async () => {
        setup({ queue: async () => [] });
        expect(screen.getByText('Cargando comandas…')).toBeInTheDocument();
        expect(await screen.findByText('Sin comandas')).toBeInTheDocument();
    });

    it('shows error banner instead of empty state', async () => {
        const { api } = setup({ queue: async () => Promise.reject(new Error('x')) });
        expect(await screen.findByText(/No se pudo cargar la cola:/)).toBeInTheDocument();
        expect(screen.queryByText('Sin comandas')).not.toBeInTheDocument();
        api.queue.mockResolvedValueOnce([mk(1)]);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('M1')).toBeInTheDocument();
    });

    it('Listo hides card and shows undo toast with mesero', async () => {
        setup();
        await screen.findByText('M1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Listo' })[0]);
        expect(screen.queryByText('M1')).not.toBeInTheDocument();
        expect(screen.getByText(/M1 lista · aviso a Ana/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Deshacer/ })).toBeInTheDocument();
    });

    it('Deshacer brings it back', async () => {
        const { api } = setup();
        await screen.findByText('M1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Listo' })[0]);
        fireEvent.click(screen.getByRole('button', { name: /Deshacer/ }));
        expect(await screen.findByText('M1')).toBeInTheDocument();
        expect(api.ready).not.toHaveBeenCalled();
    });

    it('Iniciar calls start and reloads', async () => {
        const { api } = setup({ queue: async () => [mk(1, { status: 'SENT_TO_KITCHEN' })] });
        fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
    });

    it('plays chime on new batches when sound on, not when off', async () => {
        const { api, realtime } = setup();
        await screen.findByText('M1');
        api.queue.mockResolvedValue([mk(1), mk(2), mk(3)]);
        act(() => realtime.emit('ORDER_SENT_TO_KITCHEN'));
        await screen.findByText('M3');
        expect(playKitchenChime).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Sonido/ }));
        expect(localStorage.getItem('kds.sound')).toBe('off');
        api.queue.mockResolvedValue([mk(1), mk(2), mk(3), mk(4)]);
        act(() => realtime.emit('ORDER_SENT_TO_KITCHEN'));
        await screen.findByText('M4');
        expect(playKitchenChime).toHaveBeenCalledTimes(1);
    });

    it('Recientes merges and dedupes', async () => {
        setup({ recent: [mk(1, { kitchenReleasedAt: '2026-11-21T10:00:00.000Z' }), mk(1, { kitchenReleasedAt: '2026-11-21T10:00:00.000Z' }), mk(7, { kitchenReleasedAt: '2026-11-21T09:00:00.000Z' })] });
        await screen.findByText('M1');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Recientes (2)' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Recientes (2)' }));
        const sheet = screen.getByRole('dialog');
        expect(sheet).toHaveTextContent('M1');
        expect(sheet).toHaveTextContent('M7');
        expect(sheet.querySelectorAll('li')).toHaveLength(2);
    });

    it('start in flight keeps Iniciando… disabled', async () => {
        let release!: () => void;
        const { api } = setup({ queue: async () => [mk(1, { status: 'SENT_TO_KITCHEN' })], start: () => new Promise<void>((r) => (release = r)) });
        fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
        expect(await screen.findByRole('button', { name: 'Iniciando…' })).toBeDisabled();
        api.queue.mockResolvedValue([mk(1, { status: 'IN_PREPARATION' })]);
        await act(async () => release());
        expect(await screen.findByRole('button', { name: 'Listo' })).toBeEnabled();
    });

    it('start already-done is treated as success', async () => {
        const { api } = setup({
            queue: async () => [mk(1, { status: 'SENT_TO_KITCHEN' })],
            start: () => Promise.reject(new KitchenActionError('already-done', 'ya')),
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
        await waitFor(() => expect(api.queue).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar' })).toBeEnabled());
    });

    it('start failure shows a dismissable toast, cleared by a later success', async () => {
        const { api } = setup({
            queue: async () => [mk(1, { status: 'SENT_TO_KITCHEN' })],
            start: () => Promise.reject(new KitchenActionError('rejected', 'boom')),
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
        expect(await screen.findByText('No se pudo iniciar M1: boom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(screen.queryByText('No se pudo iniciar M1: boom')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
        await screen.findByText('No se pudo iniciar M1: boom');
        api.start.mockResolvedValueOnce(undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
        await waitFor(() => expect(screen.queryByText('No se pudo iniciar M1: boom')).not.toBeInTheDocument());
    });

    it('Recientes merges local committed with server and dedupes', async () => {
        const { api } = setup({ undoMs: 10, recent: [mk(1, { kitchenReleasedAt: '2026-11-21T10:00:00.000Z' }), mk(7)] });
        await screen.findByText('M1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Listo' })[0]); // M1
        await waitFor(() => expect(api.release).toHaveBeenCalledTimes(1));
        // committed M1 + server M1 (dup) + server M7 -> 2
        await waitFor(() => expect(screen.getByRole('button', { name: 'Recientes (2)' })).toBeInTheDocument());
        const calls = api.recent.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Recientes (2)' }));
        expect(api.recent.mock.calls.length).toBe(calls + 1); // refreshed on open
        expect(screen.getByRole('dialog').querySelectorAll('li')).toHaveLength(2);
    });

    it('start hitting auth during renewal keeps Iniciando… with no failure, then retries once the session returns', async () => {
        const { api } = setup({ queue: async () => [mk(1, { status: 'SENT_TO_KITCHEN' })] });
        api.start.mockRejectedValueOnce(new KitchenActionError('auth', 'Token expirado'));
        fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole('button', { name: 'Iniciando…' })).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await act(async () => { appEvents.emit('kitchen-auth-status', 'online'); });
        await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
        const keys = (api.start.mock.calls as unknown as string[][]).map((c) => c[1]);
        expect(keys[0]).toBe(keys[1]);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('a rejected Listo commit names the table, never the raw key', async () => {
        const { api } = setup({ undoMs: 10 });
        api.ready.mockRejectedValueOnce(new KitchenActionError('rejected', 'Ya no existe'));
        await screen.findByText('M1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Listo' })[0]);
        expect(await screen.findByText('No se pudo marcar M1: Ya no existe')).toBeInTheDocument();
    });

    it('the toast band is rendered even with no toasts', async () => {
        setup();
        await screen.findByText('M1');
        expect(screen.getByTestId('kitchen-toasts')).toBeInTheDocument();
    });
});
