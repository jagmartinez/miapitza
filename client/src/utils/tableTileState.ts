import type { Table } from '../types';
import { resolveTablePresentationState } from './tablePresentation';

export type TableTileKey = 'AVAILABLE' | 'OCCUPIED' | 'PENDING_PAYMENT' | 'RESERVED' | 'OUT_OF_SERVICE';

export interface TableTileState {
    key: TableTileKey;
    label: string;
}

/** Leyenda del plano de Mesas (mockup): Libre, Ocupada, Pre-cuenta, Reservada, Fuera de servicio. */
export const TABLE_TILE_LEGEND: TableTileState[] = [
    { key: 'AVAILABLE', label: 'Libre' },
    { key: 'OCCUPIED', label: 'Ocupada' },
    { key: 'PENDING_PAYMENT', label: 'Pre-cuenta' },
    { key: 'RESERVED', label: 'Reservada' },
    { key: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
];

const LABEL = Object.fromEntries(TABLE_TILE_LEGEND.map((s) => [s.key, s.label])) as Record<TableTileKey, string>;

/**
 * Estado visible de una mesa. El consumo abierto manda (ocupada / pre-cuenta);
 * una mesa sin consumo conserva su estado administrativo (reservada, fuera de servicio).
 */
export function tableTileState(table: Pick<Table, 'status' | 'operationalState'>): TableTileState {
    const op = table.operationalState;
    if (table.status === 'OUT_OF_SERVICE' || op === 'DISABLED') return { key: 'OUT_OF_SERVICE', label: LABEL.OUT_OF_SERVICE };
    if (op === 'RESERVED' || (!op && table.status === 'RESERVED')) return { key: 'RESERVED', label: LABEL.RESERVED };
    const presentation = resolveTablePresentationState(table);
    return { key: presentation, label: LABEL[presentation] };
}
