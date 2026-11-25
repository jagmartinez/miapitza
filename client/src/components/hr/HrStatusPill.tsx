import { Badge } from '@/ui';
import { hrEmploymentTone } from './statusTone';
import type { HrEmploymentStatus } from '../../types/hr';

const LABELS: Record<HrEmploymentStatus, string> = {
    ACTIVE: 'Activo',
    ON_LEAVE: 'Con permiso',
    INACTIVE: 'Inactivo',
    SUSPENDED: 'Suspendido',
    TERMINATED: 'Finalizado',
};

export default function HrStatusPill({ status }: { status: HrEmploymentStatus }) {
    return <Badge tone={hrEmploymentTone(status)} dot>{LABELS[status]}</Badge>;
}
