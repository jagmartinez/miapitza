export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<string, Tone> = {
  OPEN: 'primary',
  PAID: 'success',
  CANCELLED: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DRAFT: 'primary',
  COMPLETED: 'success',
  IN_PROGRESS: 'primary',
  VOID: 'neutral',
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}
