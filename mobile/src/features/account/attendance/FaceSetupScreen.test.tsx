import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceSetupScreen } from './FaceSetupScreen';
import { AccountNavProvider } from '../AccountNav';
import type { HrApi } from '../hrApi';
import { mockCamera } from '../../../test/captureMocks';

const policy = { requireBiometric: true, biometricConsentVersion: 'v1', biometricRetentionNotice: 'Aviso' };

function hrWith(bio: unknown, pol: unknown = policy, over: Record<string, unknown> = {}): HrApi {
    return {
        attendancePolicy: vi.fn().mockResolvedValue(pol),
        biometricStatus: typeof bio === 'function' ? bio : vi.fn().mockResolvedValue(bio),
        ...over,
    } as unknown as HrApi;
}

function renderFace(hr: HrApi) {
    return render(
        <AccountNavProvider>
            <FaceSetupScreen hr={hr} />
        </AccountNavProvider>,
    );
}

beforeEach(() => {
    mockCamera();
});

describe('FaceSetupScreen', () => {
    it('not enrolled opens the consent and capture flow', async () => {
        renderFace(hrWith({ status: 'NOT_ENROLLED' }));
        expect(await screen.findByRole('button', { name: 'Registrar mi rostro' })).toBeDisabled();
    });

    it('revoked asks to enroll again', async () => {
        renderFace(hrWith({ status: 'REVOKED' }));
        expect(await screen.findByRole('button', { name: 'Registrar mi rostro' })).toBeInTheDocument();
    });

    it('pending shows the approval notice and can refresh', async () => {
        const bio = vi.fn().mockResolvedValueOnce({ status: 'PENDING' }).mockResolvedValueOnce({ status: 'ACTIVE', approvedAt: '2026-11-20T15:00:00Z' });
        renderFace(hrWith(bio));
        expect(await screen.findByText('Registro facial pendiente de aprobación')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        expect(await screen.findByText('Registro facial activo')).toBeInTheDocument();
    });

    it('active shows the registration date', async () => {
        renderFace(hrWith({ status: 'ACTIVE', approvedAt: '2026-11-20T15:00:00Z' }));
        expect(await screen.findByText('Registro facial activo')).toBeInTheDocument();
        expect(screen.getByText(/Registrado desde el/)).toBeInTheDocument();
    });

    it('active can register the face again', async () => {
        renderFace(hrWith({ status: 'ACTIVE', approvedAt: '2026-11-20T15:00:00Z' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Volver a registrar mi rostro' }));
        expect(await screen.findByRole('button', { name: 'Registrar mi rostro' })).toBeInTheDocument();
    });

    it('a policy without face says it is not required', async () => {
        renderFace(hrWith({ status: 'NOT_ENROLLED' }, { ...policy, requireBiometric: false }));
        expect(await screen.findByText('No se requiere registro facial')).toBeInTheDocument();
    });

    it('a failed read shows a retry that loads again', async () => {
        const bio = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce({ status: 'ACTIVE' });
        renderFace(hrWith(bio));
        const retry = await screen.findByRole('button', { name: 'Reintentar' });
        fireEvent.click(retry);
        expect(await screen.findByText('Registro facial activo')).toBeInTheDocument();
    });
});
