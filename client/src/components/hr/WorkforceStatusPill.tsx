import { Badge } from '@/ui';
import { workforceTone } from './statusTone';

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

export default function WorkforceStatusPill({ status }: { status: string }) {
  return <Badge tone={workforceTone(status)} dot>{LABELS[status] ?? status}</Badge>;
}
