import type { HrEmploymentStatus } from '../../types/hr';

const LABELS: Record<HrEmploymentStatus, string> = {
    ACTIVE: 'Activo',
    ON_LEAVE: 'Con permiso',
    INACTIVE: 'Inactivo',
    SUSPENDED: 'Suspendido',
    TERMINATED: 'Finalizado',
};

const CLASSES: Record<HrEmploymentStatus, string> = {
    ACTIVE: 'ok',
    ON_LEAVE: 'warning',
    INACTIVE: 'neutral',
    SUSPENDED: 'warning',
    TERMINATED: 'danger',
};

export default function HrStatusPill({ status }: { status: HrEmploymentStatus }) {
    return <span className={`catalog-pill ${CLASSES[status]}`}>{LABELS[status]}</span>;
}
