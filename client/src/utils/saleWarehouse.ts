import type { Warehouse } from '../types';

/**
 * Warehouse to preselect in delivery/cancel dialogs: the branch's default
 * sale warehouse when it is among the candidates, otherwise the only one.
 * Mirrors the server rule used for automatic delivery.
 */
export function preferredSaleWarehouseId(warehouses: Warehouse[]): number | null {
    const preferred = warehouses.find((warehouse) =>
        warehouse.branch?.defaultSaleWarehouseId != null
        && warehouse.branch.defaultSaleWarehouseId === warehouse.id);
    if (preferred) return preferred.id;
    return warehouses.length === 1 ? warehouses[0].id : null;
}
