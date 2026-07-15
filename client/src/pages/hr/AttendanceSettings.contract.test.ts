import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AttendanceSettings.tsx', import.meta.url), 'utf8');

describe('Owner attendance settings safety contract', () => {
  it('does not persist credentials or expose biometric evidence fields', () => {
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('templateRef');
    expect(source).not.toContain('faceImage');
    expect(source).not.toContain('providerRef');
    expect(source).not.toContain('console.');
  });

  it('states that provisioning a credential does not enable a kiosk', () => {
    expect(source).toContain('Kiosco no habilitado por esta credencial');
    expect(source).toContain('el backend no expone');
    expect(source).toContain('La clave por sí sola no significa');
  });

  it('uses server-backed versioning, revocation and retention actions', () => {
    expect(source).toContain('attendanceClient.updatePolicy');
    expect(source).toContain('attendanceClient.createDevice');
    expect(source).toContain('attendanceClient.revokeDevice');
    expect(source).toContain('attendanceClient.revokeUserBiometrics');
    expect(source).toContain('attendanceClient.runBiometricMaintenance');
    expect(source).toContain('Guardar crea una versión nueva');
  });
});
