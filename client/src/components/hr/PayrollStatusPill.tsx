const LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  RETIRED: 'Retirada',
  OPEN: 'Abierto',
  CLOSED: 'Cerrado',
  CALCULATED: 'Calculada',
  REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  PAID: 'Pagada',
  VOID: 'Anulada',
  PUBLISHED: 'Publicado',
  INFO: 'Informativa',
  WARNING: 'Advertencia',
  BLOCKING: 'Bloqueante',
};

const OK = new Set(['ACTIVE', 'APPROVED', 'PAID', 'PUBLISHED']);
const WARNING = new Set(['DRAFT', 'OPEN', 'CALCULATED', 'REVIEW', 'WARNING']);
const DANGER = new Set(['VOID', 'BLOCKING']);

export default function PayrollStatusPill({ status }: { status: string }) {
  const className = OK.has(status)
    ? 'ok'
    : DANGER.has(status)
      ? 'danger'
      : WARNING.has(status)
        ? 'warning'
        : 'neutral';
  return <span className={`hr-payroll-status ${className}`}>{LABELS[status] ?? status}</span>;
}
