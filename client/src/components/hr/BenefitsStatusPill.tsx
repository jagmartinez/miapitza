const LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  ADVANCED: 'Anticipo entregado',
  IN_SETTLEMENT: 'En liquidación',
  SETTLED: 'Liquidada',
  REQUESTED: 'Solicitado',
  DISBURSED: 'Desembolsado',
  ACTIVE: 'Activo',
  PAID: 'Pagado',
  CLOSED: 'Cerrado',
  PAUSED: 'Pausada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  REVERSED: 'Revertida',
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  OVERDUE: 'Vencida',
  ACCEPTED: 'Aceptado',
};

export default function BenefitsStatusPill({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' || status === 'APPROVED' || status === 'SETTLED' || status === 'PAID'
      ? 'success'
      : status === 'REJECTED' || status === 'CANCELLED' || status === 'REVERSED'
        ? 'danger'
        : status === 'DRAFT' || status === 'CLOSED' || status === 'COMPLETED'
          ? 'neutral'
          : 'warning';
  return <span className={`hr-benefits-status ${tone}`}>{LABELS[status] ?? status}</span>;
}
