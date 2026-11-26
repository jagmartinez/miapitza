import { Badge } from '@/ui';
import { scheduleTone } from './statusTone';
import type { HrScheduleStatus } from '../../types/hr-schedule';

const LABELS: Record<HrScheduleStatus, string> = {
    DRAFT: 'Borrador',
    PUBLISHED: 'Publicado',
    SUPERSEDED: 'Sustituido',
    CANCELLED: 'Cancelado',
};

export default function ScheduleStatusPill({ status }: { status: HrScheduleStatus }) {
    return <Badge tone={scheduleTone(status)} dot>{LABELS[status]}</Badge>;
}
