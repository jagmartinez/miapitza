import type { Table } from '../types';

export type TablePresentationState = 'AVAILABLE' | 'OCCUPIED' | 'PENDING_PAYMENT';

/**
 * The floor map deliberately exposes only the three operating states used by
 * service staff. Reservation/maintenance/grouping and kitchen progression
 * remain internal states and do not create extra colors or legends.
 */
export function resolveTablePresentationState(
    table: Pick<Table, 'status' | 'operationalState'>
): TablePresentationState {
    const state = table.operationalState
        ?? (table.status === 'AVAILABLE' ? 'AVAILABLE' : table.status === 'OCCUPIED' ? 'ATTENTION' : table.status);
    if (state === 'INVOICED' || state === 'PARTIAL_PAYMENT') return 'PENDING_PAYMENT';
    if (state === 'AVAILABLE' || state === 'PAID') return 'AVAILABLE';
    return 'OCCUPIED';
}
