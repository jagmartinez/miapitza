/**
 * POS stock availability badge (informational only: selling stays allowed,
 * negative stock is permitted by policy and raises an alert server-side).
 */
export type MenuAvailabilityStatus = 'AVAILABLE' | 'LOW' | 'OUT' | 'UNTRACKED' | 'UNKNOWN';

export interface MenuItemAvailability {
    menuItemId: number;
    status: MenuAvailabilityStatus;
    portions: number | null;
    limitingProductId: number | null;
}

export interface MenuAvailabilityResponse {
    branchId: number;
    warehouseId: number | null;
    /** Every warehouse read (sale warehouse + per-ingredient routed warehouses). */
    warehouseIds?: number[];
    reason: string | null;
    lowThreshold: number;
    items: MenuItemAvailability[];
}

export interface StockBadge {
    tone: 'out' | 'low';
    label: string;
}

export function stockBadgeFor(availability: Pick<MenuItemAvailability, 'status' | 'portions'> | undefined | null): StockBadge | null {
    if (!availability) return null;
    if (availability.status === 'OUT') return { tone: 'out', label: 'Agotado' };
    if (availability.status === 'LOW' && availability.portions != null && availability.portions > 0) {
        return { tone: 'low', label: `Quedan ${availability.portions}` };
    }
    return null;
}

export function indexAvailability(response: MenuAvailabilityResponse | null | undefined): Map<number, MenuItemAvailability> {
    return new Map((response?.items ?? []).map((item) => [item.menuItemId, item]));
}
