import type { HrScheduleStatus } from '../../types/hr-schedule';

const LABELS: Record<HrScheduleStatus, string> = {
    DRAFT: 'Borrador',
    PUBLISHED: 'Publicado',
    SUPERSEDED: 'Sustituido',
    CANCELLED: 'Cancelado',
};

const CLASSES: Record<HrScheduleStatus, string> = {
    DRAFT: 'neutral',
    PUBLISHED: 'ok',
    SUPERSEDED: 'warning',
    CANCELLED: 'danger',
};

export default function ScheduleStatusPill({ status }: { status: HrScheduleStatus }) {
    return <span className={`catalog-pill ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
