import type {
  HrAttendanceDevicePayload,
  HrAttendancePolicyPayload,
} from '../../types/hr-attendance';

function integerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateAttendancePolicy(payload: HrAttendancePolicyPayload): string | null {
  if (payload.branchId != null && !integerInRange(payload.branchId, 1, Number.MAX_SAFE_INTEGER)) {
    return 'La sucursal seleccionada no es válida.';
  }
  if (!payload.timezone.trim() || payload.timezone.length > 64) {
    return 'La zona horaria es requerida y admite hasta 64 caracteres.';
  }
  if (!integerInRange(payload.maxLocationAccuracyM, 1, 5000)) {
    return 'La precisión máxima debe ser un entero entre 1 y 5000 metros.';
  }
  if (!integerInRange(payload.earlyCheckInMinutes, 0, 1440)) {
    return 'La anticipación de entrada debe estar entre 0 y 1440 minutos.';
  }
  if (!integerInRange(payload.lateCheckInToleranceM, 0, 1440)) {
    return 'La tolerancia de llegada debe estar entre 0 y 1440 minutos.';
  }
  if (!integerInRange(payload.earlyCheckOutToleranceM, 0, 1440)) {
    return 'La tolerancia de salida anticipada debe estar entre 0 y 1440 minutos.';
  }
  if (!integerInRange(payload.lateCheckOutMinutes, 0, 2880)) {
    return 'La ventana posterior de salida debe estar entre 0 y 2880 minutos.';
  }
  if (!payload.biometricConsentVersion.trim() || payload.biometricConsentVersion.length > 64) {
    return 'La versión de consentimiento es requerida y admite hasta 64 caracteres.';
  }
  if (!integerInRange(payload.biometricRetentionDays, 1, 3650)) {
    return 'La retención biométrica debe estar entre 1 y 3650 días.';
  }
  if ((payload.biometricRetentionNotice ?? '').length > 5000) {
    return 'El aviso de retención admite hasta 5000 caracteres.';
  }
  return null;
}

export function validateAttendanceDevice(payload: HrAttendanceDevicePayload): string | null {
  if (!integerInRange(payload.branchId, 1, Number.MAX_SAFE_INTEGER)) {
    return 'Selecciona una sucursal válida.';
  }
  const name = payload.name.trim();
  if (!name || name.length > 100) return 'El nombre admite entre 1 y 100 caracteres.';
  const code = payload.code.trim();
  if (!code || code.length > 50) return 'El código admite entre 1 y 50 caracteres.';
  return null;
}

export function validateBiometricRevocation(userId: number, reason: string): string | null {
  if (!integerInRange(userId, 1, Number.MAX_SAFE_INTEGER)) {
    return 'Selecciona un usuario interno válido.';
  }
  const normalized = reason.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    return 'La razón debe contener entre 3 y 500 caracteres.';
  }
  return null;
}
