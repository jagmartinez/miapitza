import { describe, expect, it } from 'vitest';
import type { HrVacationBalance } from '../../types/hr-workforce';
import { selectVacationBalance } from './vacationBalance';

const balance = (id: number, code: string, name: string): HrVacationBalance => ({
  id,
  userId: 1,
  leaveTypeId: id,
  leaveType: {
    id,
    code,
    name,
    paid: true,
    active: true,
    balanceTracked: true,
    unit: 'DAYS',
    requiresAttachment: false,
  },
  unit: 'DAYS',
  accrued: 10,
  used: 2,
  pending: 1,
  available: 7,
  asOf: '2026-07-15',
});

describe('selectVacationBalance', () => {
  it('selects vacations semantically instead of assuming the first balance', () => {
    const sick = balance(1, 'SUBSIDIO', 'Subsidio médico');
    const vacation = balance(2, 'VACACIONES_ANUALES', 'Vacaciones anuales');
    expect(selectVacationBalance([sick, vacation])).toBe(vacation);
  });

  it('returns null when no vacation balance exists', () => {
    expect(selectVacationBalance([balance(1, 'PERMISO', 'Permiso')])).toBeNull();
  });
});
