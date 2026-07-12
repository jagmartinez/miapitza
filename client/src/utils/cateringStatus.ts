export type CateringStatus = 'QUOTED' | 'RESERVED' | 'PAID' | 'FINISHED' | 'CANCELLED';

const MANUAL_TRANSITIONS: Record<CateringStatus, readonly CateringStatus[]> = {
    QUOTED: ['RESERVED', 'CANCELLED'],
    RESERVED: ['CANCELLED'],
    PAID: ['FINISHED'],
    FINISHED: [],
    CANCELLED: [],
};

export function getCateringStatusOptions(current?: CateringStatus): CateringStatus[] {
    if (!current) return ['QUOTED'];
    return [current, ...MANUAL_TRANSITIONS[current]];
}

export function isCateringStatusTerminal(status: CateringStatus): boolean {
    return MANUAL_TRANSITIONS[status].length === 0;
}
