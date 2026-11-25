import { Badge } from '@/ui';
import { payrollTone } from './statusTone';

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

export default function PayrollStatusPill({ status }: { status: string }) {
  return <Badge tone={payrollTone(status)} dot>{LABELS[status] ?? status}</Badge>;
}
