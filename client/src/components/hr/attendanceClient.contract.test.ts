import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./attendanceClient.ts', import.meta.url), 'utf8');

describe('Phase 3 attendance API contract', () => {
  it('uses the exact versioned attendance and biometric endpoints', () => {
    expect(source).toContain("const HR_BASE = '/v1/hr'");
    expect(source).toContain('`${HR_BASE}/attendance/policy`');
    expect(source).toContain('`${HR_BASE}/me/attendance/today`');
    expect(source).toContain('`${HR_BASE}/biometrics/challenges`');
    expect(source).toContain('`${HR_BASE}/biometrics/me`');
    expect(source).toContain('`${HR_BASE}/biometrics/enroll`');
    expect(source).toContain('`${HR_BASE}/attendance/punches`');
    expect(source).toContain('`${HR_BASE}/attendance/events`');
    expect(source).toContain('`${HR_BASE}/attendance/events/${id}/review`');
    expect(source).toContain('`${HR_BASE}/attendance/manual`');
    expect(source).toContain('`${HR_BASE}/attendance/devices`');
    expect(source).toContain('`${HR_BASE}/attendance/devices/${id}/revoke`');
    expect(source).toContain('`${HR_BASE}/biometrics/users/${userId}/revoke`');
    expect(source).toContain('`${HR_BASE}/biometrics/maintenance/run`');
    expect(source).toContain('`${HR_BASE}/biometrics/provider/health`');
  });

  it('sends evidence as multipart and requires idempotency headers', () => {
    const enrollmentRequest = source.slice(
      source.indexOf('async enrollBiometrics'),
      source.indexOf('async revokeMyBiometrics')
    );
    const punchRequest = source.slice(
      source.indexOf('async createPunch'),
      source.indexOf('async getEvents')
    );

    expect(source).toContain('new FormData()');
    expect(source).toContain("form.append('faceImage'");
    expect(source).toContain("form.append('faceFrames'");
    expect(enrollmentRequest).toContain("'Content-Type': 'multipart/form-data'");
    expect(punchRequest).toContain("'Content-Type': 'multipart/form-data'");
    expect(punchRequest).toContain("'Idempotency-Key': idempotencyKey");
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('toDataURL');
    expect(source).not.toContain('base64');
  });

  it('keeps capture evidence out of browser persistence across the attendance UI', () => {
    const captureSources = [
      './CameraCapture.tsx',
      './AttendancePunchWizard.tsx',
      './attendanceRules.ts',
      '../../pages/hr/Biometrics.tsx',
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');

    expect(captureSources).not.toContain('localStorage');
    expect(captureSources).not.toContain('sessionStorage');
    expect(captureSources).not.toContain('toDataURL');
    expect(captureSources).not.toContain('console.log');
    expect(captureSources).toContain('URL.revokeObjectURL');
    expect(captureSources).toContain('track.stop()');
    expect(captureSources).toContain('Comenzar prueba guiada');
    expect(captureSources).toContain('¡AHORA GIRA!');
    expect(captureSources).toContain('hr-camera-recording-dot');
    expect(captureSources).toContain('Capturando giro: cuadro');
    expect(captureSources).toContain('livenessAction={challenge.livenessAction}');
    expect(captureSources).toContain('await wait(900)');
    expect(captureSources).toContain('frames.push(await captureFrame())');
    expect(captureSources).toContain('ESTÁS MARCANDO');
    expect(captureSources).toContain('Sucursal a validar');
    expect(captureSources).toContain('Geocerca de la sucursal');
    expect(captureSources).toContain('Cancelar intento');
    expect(captureSources).toContain('No se creó una salida automática ni se abrió una jornada nueva.');
    expect(captureSources).toContain('Solicitar corrección');
  });

  it('bypasses offline cache for every sensitive owner settings read', () => {
    const policyRead = source.slice(
      source.indexOf('async getPolicy'),
      source.indexOf('async updatePolicy')
    );
    const lookupRead = source.slice(
      source.indexOf('async getSettingsLookups'),
      source.indexOf('async getToday')
    );
    const deviceRead = source.slice(
      source.indexOf('async getDevices'),
      source.indexOf('async createDevice')
    );

    expect(policyRead).toContain('skipOfflineCache: true');
    expect(lookupRead).toContain('skipOfflineCache: true');
    expect(deviceRead).toContain('skipOfflineCache: true');
  });

  it('keeps the one-time device key separate from list reads and browser persistence', () => {
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('offlineMeta');
    expect(source).toContain('Promise<HrAttendanceDeviceCredential>');
    expect(source).toContain('Promise<HrAttendanceDevice[]>');
  });
});
