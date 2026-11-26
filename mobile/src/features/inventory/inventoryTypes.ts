/** Blind-count DTOs, as the counter's endpoints answer them (server inventory-count.service.ts). Never carry expected stock or costs. */

export type CountSheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type CountDisplayStatus = 'EN_CURSO' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO' | 'DEVUELTO';

/** A unit a product can be counted in. */
export type CountUnit = { abbreviation: string; name: string; factor: number };

export interface CountLine {
    productId: number;
    name: string;
    sku: string | null;
    categoryId: number | null;
    baseUnit: string;
    units: CountUnit[];
    /** The unit of the saved quantity (null while uncounted). */
    unit: string | null;
    countedQuantity: number | null;
    counted: boolean;
    /** The reviewer asked for this one again. */
    recountRequested: boolean;
}

export interface CountCategory {
    categoryId: number | null;
    name: string;
}

export interface CountSheet {
    id: number;
    status: CountSheetStatus;
    displayStatus: CountDisplayStatus;
    warehouse: { id: number; name: string };
    startedAt: string;
    startedByName: string;
    scopeLabel: string;
    returnNote: string | null;
    categories: CountCategory[];
    lines: CountLine[];
}

export interface CountWarehouse {
    id: number;
    name: string;
    type: string;
    productCount: number;
    lastCountAt: string | null;
    /** A sheet already open in this warehouse blocks a new count. */
    openSheet: { id: number; status: 'DRAFT' | 'SUBMITTED' } | null;
}

export interface WarehouseCategory {
    categoryId: number | null;
    name: string;
    productCount: number;
}

export type RecentResult = { differences: number; value: number } | { recount: number } | null;

export interface RecentSheet {
    id: number;
    warehouseName: string;
    startedAt: string;
    startedByName: string;
    status: CountSheetStatus;
    displayStatus: CountDisplayStatus;
    productCount: number;
    countedCount: number;
    scopeLabel: string;
    result: RecentResult;
}

export type RecentFilter = 'open' | 'review' | 'approved' | 'all';

export interface StartedSheet {
    id: number;
    status: 'DRAFT';
    warehouseId: number;
    productCount: number;
}

export interface SubmittedSheet {
    id: number;
    status: 'SUBMITTED';
    counted: number;
    notCounted: number;
}

/** Machine codes the counter's endpoints answer with. */
export const COUNT_ERROR = {
    warehouseBusy: 'INVENTORY_COUNT_WAREHOUSE_BUSY',
    notEditable: 'INVENTORY_COUNT_NOT_EDITABLE',
    empty: 'INVENTORY_COUNT_EMPTY',
    recountPending: 'INVENTORY_COUNT_RECOUNT_PENDING',
} as const;
