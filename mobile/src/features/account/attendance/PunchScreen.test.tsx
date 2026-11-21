import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PunchScreen } from './PunchScreen';
import { AccountNavProvider, useAccountNav } from '../AccountNav';
import { ToastProvider } from '../../../ui/Toast';
import { HrError, type HrApi } from '../hrApi';
import { mockCamera, mockGeolocation, type CameraMock } from '../../../test/captureMocks';

const today = {
    serverTime: '2026-11-20T08:00:00Z',
    timezone: 'UTC',
    policy: { requireBiometric: true, requireLiveness: true, requireGeolocation: true, maxLocationAccuracyM: 50, biometricConsentVersion: 'v1', biometricRetentionNotice: 'Aviso de retención' },
    targetBranch: { id: 1, name: 'Matriz' },
    locationRequirements: { maxAccuracyM: 50, geofenceRadiusM: 100 },
    availableActions: ['CHECK_IN'],
    punches: [],
    blockingIssue: null,
    scheduledShift: { id: 1, branchId: 1, startAt: '2026-11-20T08:00:00Z', endAt: '2026-11-20T16:00:00Z' },
};
const challenge = (over = {}) => ({
    id: 'c1',
    token: 't1',
    purpose: 'ATTENDANCE_PUNCH',
    livenessInstruction: 'Gira la cabeza a la izquierda',
    captureFrameCount: 3,
    captureIntervalMs: 0,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...over,
});
const accepted = { decision: 'ACCEPTED', message: 'ok', checks: {}, punch: { id: 1, action: 'CHECK_IN', occurredAt: '2026-11-20T08:02:30Z' } };

let nav: ReturnType<typeof useAccountNav>;
function Open() {
    nav = useAccountNav();
    const { navigate } = nav;
    useEffect(() => navigate('punch', { action: 'CHECK_IN' }), [navigate]);
    return null;
}
function Host({ hr }: { hr: HrApi }) {
    const { section } = useAccountNav();
    return section === 'punch' ? <PunchScreen hr={hr} /> : null;
}

let cam: CameraMock;
function setup(over: Record<string, unknown> = {}) {
    const hr = {
        attendanceToday: vi.fn().mockResolvedValue(today),
        attendancePolicy: vi.fn().mockResolvedValue(today.policy),
        biometricStatus: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
        createChallenge: vi.fn().mockImplementation(async () => challenge()),
        punch: vi.fn().mockResolvedValue(accepted),
        ...over,
    } as unknown as HrApi;
    render(
        <ToastProvider>
            <AccountNavProvider>
                <Open />
                <Host hr={hr} />
            </AccountNavProvider>
        </ToastProvider>,
    );
    return hr;
}
const start = async () => fireEvent.click(await screen.findByRole('button', { name: /^Marcar/ }));

beforeEach(() => {
    cam = mockCamera();
    mockGeolocation({ accuracy: 12 });
});
afterEach(() => vi.useRealTimers());

describe('PunchScreen', () => {
    it('ACCEPTED shows time', async () => {
        const hr = setup();
        expect(await screen.findByText(/Matriz/)).toBeInTheDocument();
        await start();
        expect(await screen.findByText('Entrada registrada 08:02')).toBeInTheDocument();
        const form = (hr.punch as ReturnType<typeof vi.fn>).mock.calls[0][0] as FormData;
        expect(form.getAll('faceImage')).toHaveLength(1);
        expect(form.getAll('faceFrames')).toHaveLength(2);
        expect(form.get('challengeId')).toBe('c1');
        expect(form.get('challengeToken')).toBe('t1');
        expect(form.get('latitude')).toBe('1.5');
        expect(form.get('action')).toBe('CHECK_IN');
        expect(cam.track.stop).toHaveBeenCalled();
    });

    it('shows sending state while the request is in flight', async () => {
        let release!: (v: unknown) => void;
        setup({ punch: vi.fn(() => new Promise((r) => (release = r))) });
        await start();
        await screen.findByText(/Enviando/);
        release(accepted);
    });

    it('camera denied shows settings hint', async () => {
        mockCamera({ reject: 'NotAllowedError' });
        setup();
        await start();
        expect(await screen.findByText('Activa la cámara para la app en Ajustes del teléfono.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });

    it('location denied shows settings hint', async () => {
        mockGeolocation({ error: 1 });
        const hr = setup();
        await start();
        expect(await screen.findByText('Activa la ubicación para la app en Ajustes del teléfono.')).toBeInTheDocument();
        expect(hr.createChallenge).not.toHaveBeenCalled();
    });

    it('accuracy above max shows retry', async () => {
        mockGeolocation({ accuracy: 80.4 });
        const hr = setup();
        await start();
        expect(await screen.findByText('Ubicación imprecisa (±80 m). Sal a un lugar abierto y reintenta.')).toBeInTheDocument();
        expect(hr.createChallenge).not.toHaveBeenCalled();
        mockGeolocation({ accuracy: 10 });
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('Entrada registrada 08:02')).toBeInTheDocument();
    });

    it('retry after timeout reuses idempotency key and challenge', async () => {
        const punch = vi
            .fn()
            .mockRejectedValueOnce(new HrError('timeout', { isAmbiguous: true }))
            .mockResolvedValueOnce(accepted);
        const hr = setup({ punch });
        await start();
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('Entrada registrada 08:02')).toBeInTheDocument();
        expect(punch).toHaveBeenCalledTimes(2);
        expect(punch.mock.calls[1][0]).toBe(punch.mock.calls[0][0]);
        expect(punch.mock.calls[1][1].actionId).toBe(punch.mock.calls[0][1].actionId);
        expect(hr.createChallenge).toHaveBeenCalledTimes(1);
    });

    it('expired challenge gets a new challenge and new key', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const punch = vi
            .fn()
            .mockRejectedValueOnce(new HrError('timeout', { isAmbiguous: true }))
            .mockResolvedValueOnce(accepted);
        const hr = setup({ punch });
        await start();
        const retry = await screen.findByRole('button', { name: 'Reintentar' });
        vi.setSystemTime(Date.now() + 400_000);
        fireEvent.click(retry);
        expect(await screen.findByText('Entrada registrada 08:02')).toBeInTheDocument();
        expect(hr.createChallenge).toHaveBeenCalledTimes(2);
        expect(punch.mock.calls[1][1].actionId).not.toBe(punch.mock.calls[0][1].actionId);
    });

    it('REVIEW_REQUIRED amber', async () => {
        setup({ punch: vi.fn().mockResolvedValue({ decision: 'REVIEW_REQUIRED', message: 'Llegaste tarde', checks: {} }) });
        await start();
        const el = await screen.findByText('Registrado — RH lo revisará: Llegaste tarde');
        expect(el.closest('[data-tone]')).toHaveAttribute('data-tone', 'review');
    });

    it('REJECTED shows reason not error', async () => {
        setup({
            punch: vi.fn().mockResolvedValue({
                decision: 'REJECTED',
                message: 'Fuera de la sucursal',
                checks: { geofence: { status: 'FAILED', reasonCode: 'OUTSIDE_GEOFENCE', message: 'x' } },
            }),
        });
        await start();
        expect(await screen.findByText('Fuera de la sucursal')).toBeInTheDocument();
        expect(screen.getByText('Geocerca de la sucursal')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('FACE_PROVIDER_UNAVAILABLE message', async () => {
        setup({ punch: vi.fn().mockRejectedValue(new HrError('x', { code: 'FACE_PROVIDER_UNAVAILABLE', status: 503, isAmbiguous: true })) });
        await start();
        expect(await screen.findByText('El reconocimiento facial no está disponible. Intenta en unos minutos.')).toBeInTheDocument();
    });

    it('not enrolled routes to enrollment with consent', async () => {
        setup({ biometricStatus: vi.fn().mockResolvedValue({ status: 'NOT_ENROLLED' }) });
        expect(await screen.findByText('Aviso de retención')).toBeInTheDocument();
        expect(screen.getByLabelText('Acepto')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Marcar/ })).toBeNull();
    });

    it('PENDING enrollment blocks punching', async () => {
        setup({ biometricStatus: vi.fn().mockResolvedValue({ status: 'PENDING', pendingApproval: true }) });
        expect(await screen.findByText('Registro facial pendiente de aprobación')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Marcar/ })).toBeNull();
    });

    it('429 challenge error shows the server message and restarts fresh', async () => {
        const punch = vi
            .fn()
            .mockRejectedValueOnce(new HrError('Demasiados intentos con este reto.', { code: 'CHALLENGE_ATTEMPTS_EXCEEDED', status: 429, isAmbiguous: true }))
            .mockResolvedValueOnce(accepted);
        const hr = setup({ punch });
        await start();
        expect(await screen.findByText('Demasiados intentos con este reto.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('Entrada registrada 08:02')).toBeInTheDocument();
        expect(hr.createChallenge).toHaveBeenCalledTimes(2);
        expect(punch.mock.calls[1][1].actionId).not.toBe(punch.mock.calls[0][1].actionId);
        expect(punch.mock.calls[1][0]).not.toBe(punch.mock.calls[0][0]);
    });

    it('409 domain error restarts fresh', async () => {
        const punch = vi
            .fn()
            .mockRejectedValueOnce(new HrError('El reto ya fue usado.', { code: 'CHALLENGE_REPLAY', status: 409, isAmbiguous: true }))
            .mockResolvedValueOnce(accepted);
        const hr = setup({ punch });
        await start();
        expect(await screen.findByText('El reto ya fue usado.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await screen.findByText('Entrada registrada 08:02');
        expect(hr.createChallenge).toHaveBeenCalledTimes(2);
    });

    it('requireBiometric false still creates the challenge but skips the camera and frames', async () => {
        const t = { ...today, policy: { ...today.policy, requireBiometric: false } };
        const hr = setup({ attendanceToday: vi.fn().mockResolvedValue(t) });
        await start();
        await screen.findByText('Entrada registrada 08:02');
        expect(hr.createChallenge).toHaveBeenCalledTimes(1);
        expect(cam.getUserMedia).not.toHaveBeenCalled();
        const form = (hr.punch as ReturnType<typeof vi.fn>).mock.calls[0][0] as FormData;
        expect(form.get('challengeId')).toBe('c1');
        expect(form.getAll('faceImage')).toHaveLength(0);
    });

    it('double tap runs the flow once (requireGeolocation false)', async () => {
        const t = { ...today, policy: { ...today.policy, requireGeolocation: false } };
        const hr = setup({ attendanceToday: vi.fn().mockResolvedValue(t) });
        const btn = await screen.findByRole('button', { name: /^Marcar/ });
        fireEvent.click(btn);
        fireEvent.click(btn);
        await screen.findByText('Entrada registrada 08:02');
        expect(hr.createChallenge).toHaveBeenCalledTimes(1);
        expect(hr.punch).toHaveBeenCalledTimes(1);
    });

    it('back during createChallenge never opens the camera or punches', async () => {
        let release!: (c: unknown) => void;
        const hr = setup({ createChallenge: vi.fn(() => new Promise((r) => (release = r))) });
        await start();
        await waitFor(() => expect(hr.createChallenge).toHaveBeenCalled());
        act(() => nav.back());
        await act(async () => release(challenge()));
        expect(cam.getUserMedia).not.toHaveBeenCalled();
        expect(hr.punch).not.toHaveBeenCalled();
    });

    it('back during capture stops the tracks and never punches', async () => {
        const hr = setup({ createChallenge: vi.fn().mockResolvedValue(challenge({ captureFrameCount: 4, captureIntervalMs: 60 })) });
        await start();
        await waitFor(() => expect(cam.getUserMedia).toHaveBeenCalled());
        act(() => nav.back());
        await new Promise((r) => setTimeout(r, 400));
        expect(cam.track.stop).toHaveBeenCalled();
        expect(hr.punch).not.toHaveBeenCalled();
    });

    it('an action not available goes back home', async () => {
        const t = { ...today, availableActions: ['CHECK_OUT'] };
        setup({ attendanceToday: vi.fn().mockResolvedValue(t) });
        await waitFor(() => expect(nav.section).toBe('home'));
    });

    it('PENDING screen can refresh the status', async () => {
        const biometricStatus = vi.fn().mockResolvedValueOnce({ status: 'PENDING' }).mockResolvedValue({ status: 'ACTIVE' });
        setup({ biometricStatus });
        fireEvent.click(await screen.findByRole('button', { name: 'Actualizar' }));
        expect(await screen.findByRole('button', { name: /^Marcar/ })).toBeInTheDocument();
    });
});
