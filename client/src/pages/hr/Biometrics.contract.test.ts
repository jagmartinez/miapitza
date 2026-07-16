import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Biometrics.tsx', import.meta.url), 'utf8');

describe('Biometrics guided UX contract', () => {
    it('keeps the sensitive server contract and browser-only evidence lifecycle intact', () => {
        expect(source).toContain("attendanceClient.createChallenge('BIOMETRIC_ENROLLMENT')");
        expect(source).toContain('attendanceClient.enrollBiometrics');
        expect(source).toContain('attendanceClient.revokeMyBiometrics');
        expect(source).toContain('consentAccepted: true');
        expect(source).toContain('consentVersion: policy.biometricConsentVersion');
        expect(source).toContain('faceImage,');
        expect(source).not.toContain('localStorage');
        expect(source).not.toContain('sessionStorage');
        expect(source).not.toContain('toDataURL');
    });

    it('presents status, privacy, enrolment steps, consent, recovery and revocation', () => {
        expect(source).toContain('Estado de mi perfil');
        expect(source).toContain('aria-label="Progreso del enrolamiento"');
        expect(source).toContain("{ id: 'privacy'");
        expect(source).toContain("{ id: 'capture'");
        expect(source).toContain("{ id: 'confirm'");
        expect(source).toContain('Control y privacidad');
        expect(source).toContain('profile.canEnroll === false');
        expect(source).toContain("error?.includes('expiró')");
        expect(source).toContain('Revocar biometría');
    });
});
