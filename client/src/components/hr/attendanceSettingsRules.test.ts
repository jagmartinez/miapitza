import { describe, expect, it } from 'vitest';
import {
  validateAttendanceDevice,
  validateAttendancePolicy,
  validateBiometricRevocation,
} from './attendanceSettingsRules';
import type { HrAttendancePolicyPayload } from '../../types/hr-attendance';

const validPolicy: HrAttendancePolicyPayload = {
  branchId: null,
  timezone: 'America/Managua',
  requireBiometric: true,
  requireLiveness: true,
  requireGeolocation: true,
  maxLocationAccuracyM: 50,
  earlyCheckInMinutes: 60,
  lateCheckInToleranceM: 10,
  earlyCheckOutToleranceM: 15,
  lateCheckOutMinutes: 240,
  scheduleViolationMode: 'REVIEW',
  geofenceViolationMode: 'BLOCK',
  biometricViolationMode: 'BLOCK',
  allowUnscheduledPunch: false,
  unscheduledViolationMode: 'REVIEW',
  allowManualFallback: true,
  biometricConsentVersion: 'v1',
  biometricRetentionDays: 365,
  biometricRetentionNotice: null,
};

describe('attendance settings validation', () => {
  it('accepts the server policy bounds and rejects values outside them', () => {
    expect(validateAttendancePolicy(validPolicy)).toBeNull();
    expect(validateAttendancePolicy({ ...validPolicy, maxLocationAccuracyM: 0 })).toContain(
      '1 y 5000'
    );
    expect(validateAttendancePolicy({ ...validPolicy, lateCheckOutMinutes: 2881 })).toContain(
      '2880'
    );
    expect(validateAttendancePolicy({ ...validPolicy, biometricRetentionDays: 3651 })).toContain(
      '3650'
    );
  });

  it('matches device branch, name and code constraints', () => {
    expect(
      validateAttendanceDevice({ branchId: 1, name: 'Tablet entrada', code: 'ENTRADA-01' })
    ).toBeNull();
    expect(validateAttendanceDevice({ branchId: 0, name: 'Tablet', code: 'A' })).toContain(
      'sucursal'
    );
    expect(validateAttendanceDevice({ branchId: 1, name: '', code: 'A' })).toContain('nombre');
  });

  it('requires an internal user id and the exact revocation reason length', () => {
    expect(validateBiometricRevocation(7, 'Baja laboral')).toBeNull();
    expect(validateBiometricRevocation(0, 'Baja laboral')).toContain('usuario interno');
    expect(validateBiometricRevocation(7, 'no')).toContain('3 y 500');
  });
});
