import { act, fireEvent, render, screen } from '@testing-library/react';
import { appEvents } from '../../core/events';
import { describe, expect, it, vi } from 'vitest';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { connectionOf, KitchenHome } from './KitchenHome';

const kiosk = vi.hoisted(() => ({ enterKiosk: vi.fn(async () => {}), exitKiosk: vi.fn(async () => {}) }));
vi.mock('../../core/kiosk', () => kiosk);

const services = () =>
    ({
        http: {
            get: vi.fn(async (url: string) => ({
                data: {
                    data: url.endsWith('/queue')
                        ? [{ id: 1, kitchenBatchId: 1, status: 'SENT_TO_KITCHEN', table: { number: 1 }, user: { id: 1, name: 'Ana' }, orderType: 'DINE_IN', createdAt: new Date().toISOString(), items: [{ id: 1, quantity: 1, sentAt: new Date().toISOString(), menuItem: { name: 'Taco' } }] }]
                        : url.endsWith('/config')
                          ? { warningMinutes: 5, urgentMinutes: 10 }
                          : [],
                },
            })),
            post: vi.fn(),
        },
        realtime: { subscribe: vi.fn(() => () => {}) },
    }) as unknown as Services;
const session = (permissions: string[]) => ({ token: 't', user: { id: 3, name: 'Cocina', roles: ['COCINA'], permissions } }) as unknown as Session;

describe('KitchenHome permissions', () => {
    it('without kds.manage the buttons are disabled with a reason', async () => {
        render(<KitchenHome session={session([])} services={services()} />);
        expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeDisabled();
        expect(screen.getByText('Sin permiso para marcar')).toBeInTheDocument();
    });

    it('with kds.manage the button is enabled', async () => {
        render(<KitchenHome session={session(['kds.manage'])} services={services()} />);
        expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeEnabled();
    });
});

describe('KitchenHome kiosk', () => {
    beforeEach(() => {
        kiosk.enterKiosk.mockClear();
        kiosk.exitKiosk.mockClear();
    });
    afterEach(() => vi.restoreAllMocks());

    it('enterKiosk on mount, exitKiosk on unmount', async () => {
        const { unmount } = render(<KitchenHome session={session([])} services={services()} />);
        await screen.findByRole('button', { name: 'Iniciar' });
        expect(kiosk.enterKiosk).toHaveBeenCalledTimes(1);
        expect(kiosk.exitKiosk).not.toHaveBeenCalled();
        unmount();
        expect(kiosk.exitKiosk).toHaveBeenCalledTimes(1);
    });

    it('long-press 5 s on title opens the confirm sheet and Salir exits', async () => {
        render(<KitchenHome session={session([])} services={services()} />);
        await screen.findByRole('button', { name: 'Iniciar' });
        vi.useFakeTimers();
        try {
            fireEvent.pointerDown(screen.getByText('Cocina'));
            act(() => { vi.advanceTimersByTime(5_000); });
        } finally {
            vi.useRealTimers();
        }
        expect(screen.getByText('¿Salir del modo kiosco?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
        expect(kiosk.exitKiosk).toHaveBeenCalledTimes(1);
    });
});

describe('KitchenHome session gating', () => {
    it('no queue request before the first session', async () => {
        const svc = services();
        const { rerender } = render(<KitchenHome session={null} services={svc} />);
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        expect(svc.http.get).not.toHaveBeenCalled();
        expect(screen.getByText('Cargando comandas…')).toBeInTheDocument();
        rerender(<KitchenHome session={session(['kds.manage'])} services={svc} />);
        expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeEnabled();
        expect(svc.http.get).toHaveBeenCalled();
    });

    it('a renewal (session briefly null) does not blank the board', async () => {
        const svc = services();
        const { rerender } = render(<KitchenHome session={session(['kds.manage'])} services={svc} />);
        await screen.findByRole('button', { name: 'Iniciar' });
        rerender(<KitchenHome session={null} services={svc} />);
        expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument();
    });
});

describe('connectionOf', () => {
    it('maps realtime/auth to the indicator', () => {
        expect(connectionOf('online', true, true)).toBe('online');
        expect(connectionOf('online', false, true)).toBe('reconnecting');
        expect(connectionOf('offline', false, true)).toBe('reconnecting');
        expect(connectionOf('renewing', true, true)).toBe('reconnecting');
        expect(connectionOf('connecting', true, false)).toBe('reconnecting');
        expect(connectionOf('online', false, true, true)).toBe('offline');
        expect(connectionOf('renewing', false, true, true)).toBe('offline');
        expect(connectionOf('account-unavailable', false, true, true)).toBe('unavailable');
        expect(connectionOf('account-unavailable', true, true)).toBe('unavailable');
    });

    it('Sin conexión only after realtime was offline for 30 s', async () => {
        vi.useFakeTimers();
        try {
            render(<KitchenHome session={session([])} services={services()} />);
            act(() => { appEvents.emit('realtime-status', 'offline'); });
            act(() => { vi.advanceTimersByTime(29_999); });
            expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
            act(() => { vi.advanceTimersByTime(1); });
            expect(screen.getByRole('status')).toHaveTextContent('Sin conexión');
            act(() => { appEvents.emit('realtime-status', 'online'); });
        } finally {
            vi.useRealTimers();
        }
    });
});
