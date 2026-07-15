const LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
  APPLIED: 'Aplicado',
  OPEN: 'Abierto',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
  RESOLVED: 'Resuelta',
  DISMISSED: 'Descartada',
  INFO: 'Informativa',
  WARNING: 'Advertencia',
  CRITICAL: 'Crítica',
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

const OK = new Set(['APPROVED', 'APPLIED', 'RESOLVED', 'ACTIVE']);
const WARNING = new Set(['PENDING', 'OPEN', 'REOPENED', 'WARNING']);
const DANGER = new Set(['REJECTED', 'CRITICAL']);

export default function WorkforceStatusPill({ status }: { status: string }) {
  const className = OK.has(status)
    ? 'ok'
    : DANGER.has(status)
      ? 'danger'
      : WARNING.has(status)
        ? 'warning'
        : 'neutral';
  return <span className={`catalog-pill ${className}`}>{LABELS[status] ?? status}</span>;
}
