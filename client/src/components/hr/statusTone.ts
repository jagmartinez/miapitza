import type { Tone } from '@/ui';

/** Tonos de estado de RH por dominio: el mismo código (p. ej. OPEN) no significa lo mismo en nómina que en asistencia. */
type ToneSets = { success?: string[]; warning?: string[]; danger?: string[]; primary?: string[] };

function toneResolver(sets: ToneSets, fallback: Tone = 'neutral') {
  return (status: string): Tone => {
    if (sets.success?.includes(status)) return 'success';
    if (sets.danger?.includes(status)) return 'danger';
    if (sets.warning?.includes(status)) return 'warning';
    if (sets.primary?.includes(status)) return 'primary';
    return fallback;
  };
}

export const hrEmploymentTone = toneResolver({
  success: ['ACTIVE'],
  warning: ['ON_LEAVE', 'SUSPENDED'],
  danger: ['TERMINATED'],
});

export const payrollTone = toneResolver({
  success: ['ACTIVE', 'APPROVED', 'PAID', 'PUBLISHED'],
  danger: ['VOID', 'BLOCKING'],
  warning: ['DRAFT', 'OPEN', 'CALCULATED', 'REVIEW', 'WARNING'],
});

export const workforceTone = toneResolver({
  success: ['APPROVED', 'APPLIED', 'RESOLVED', 'ACTIVE'],
  danger: ['REJECTED', 'CRITICAL'],
  warning: ['PENDING', 'OPEN', 'REOPENED', 'WARNING'],
});

export const scheduleTone = toneResolver({
  success: ['PUBLISHED'],
  warning: ['SUPERSEDED'],
  danger: ['CANCELLED'],
});

export const benefitsTone = (status: string): Tone => {
  if (['ACTIVE', 'APPROVED', 'SETTLED', 'PAID'].includes(status)) return 'success';
  if (['REJECTED', 'CANCELLED', 'REVERSED'].includes(status)) return 'danger';
  if (['DRAFT', 'CLOSED', 'COMPLETED'].includes(status)) return 'neutral';
  return 'warning';
};
