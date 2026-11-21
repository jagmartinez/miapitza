import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollScreen } from './EnrollScreen';
import type { HrApi } from '../hrApi';
import { mockCamera } from './captureMocks';

const policy = { biometricConsentVersion: 'v7', biometricRetentionNotice: 'Aviso' } as never;

beforeEach(() => {
    mockCamera();
});

describe('EnrollScreen', () => {
    it('requires consent, then enrolls with consent fields', async () => {
        const hr = {
            createChallenge: vi.fn().mockResolvedValue({ id: 'c9', token: 't9', captureFrameCount: 2, captureIntervalMs: 0, expiresAt: new Date(Date.now() + 1e5).toISOString(), livenessInstruction: 'Gira' }),
            enroll: vi.fn().mockResolvedValue({ status: 'PENDING', pendingApproval: true }),
        } as unknown as HrApi;
        const onDone = vi.fn();
        render(<EnrollScreen hr={hr} policy={policy} onDone={onDone} />);
        const go = screen.getByRole('button', { name: 'Registrar mi rostro' });
        expect(go).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Acepto'));
        fireEvent.click(go);
        expect(await screen.findByText('Enviado. RH debe aprobar tu registro antes de marcar.')).toBeInTheDocument();
        expect(hr.createChallenge).toHaveBeenCalledWith('BIOMETRIC_ENROLLMENT');
        const form = (hr.enroll as ReturnType<typeof vi.fn>).mock.calls[0][0] as FormData;
        expect(form.get('consentAccepted')).toBe('true');
        expect(form.get('consentVersion')).toBe('v7');
        expect(form.get('challengeId')).toBe('c9');
        expect(form.getAll('faceImage')).toHaveLength(1);
        expect(form.getAll('faceFrames')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
        expect(onDone).toHaveBeenCalledWith({ status: 'PENDING', pendingApproval: true });
    });
});
