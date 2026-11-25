import { Badge } from '@/ui';
import { benefitsTone } from './statusTone';

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
  return <Badge tone={benefitsTone(status)} dot>{LABELS[status] ?? status}</Badge>;
}
