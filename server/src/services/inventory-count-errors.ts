/**
 * Typed business errors of the blind inventory count. `code` is the stable
 * machine identifier clients branch on. `details` (e.g. `{ sheetId }`,
 * `{ products }`) is sent as an object by the count router.
 */
export type InventoryCountErrorCode =
    | 'INVENTORY_COUNT_NOT_FOUND'
    | 'INVENTORY_COUNT_WAREHOUSE_BUSY'
    | 'INVENTORY_COUNT_NOT_EDITABLE'
    | 'INVENTORY_COUNT_INVALID'
    | 'INVENTORY_COUNT_UNIT_INVALID'
    | 'INVENTORY_COUNT_EMPTY'
    | 'INVENTORY_COUNT_RECOUNT_PENDING'
    | 'INVENTORY_COUNT_COST_MISSING';

const INVENTORY_COUNT_ERROR_STATUS: Record<InventoryCountErrorCode, number> = {
    INVENTORY_COUNT_NOT_FOUND: 404,
    INVENTORY_COUNT_WAREHOUSE_BUSY: 409,
    INVENTORY_COUNT_NOT_EDITABLE: 409,
    INVENTORY_COUNT_INVALID: 400,
    INVENTORY_COUNT_UNIT_INVALID: 400,
    INVENTORY_COUNT_EMPTY: 409,
    INVENTORY_COUNT_RECOUNT_PENDING: 409,
    INVENTORY_COUNT_COST_MISSING: 409,
};

const INVENTORY_COUNT_ERROR_MESSAGE: Record<InventoryCountErrorCode, string> = {
    INVENTORY_COUNT_NOT_FOUND: 'Conteo no encontrado',
    INVENTORY_COUNT_WAREHOUSE_BUSY: 'La bodega ya tiene un conteo abierto',
    INVENTORY_COUNT_NOT_EDITABLE: 'El conteo ya no se puede modificar',
    INVENTORY_COUNT_INVALID: 'Datos de conteo inválidos',
    INVENTORY_COUNT_UNIT_INVALID: 'La unidad no es válida para este producto',
    INVENTORY_COUNT_EMPTY: 'No hay ningún producto contado',
    INVENTORY_COUNT_RECOUNT_PENDING: 'Hay productos pendientes de reconteo',
    INVENTORY_COUNT_COST_MISSING: 'Faltan costos para ajustar algunos productos',
};

export class InventoryCountError extends Error {
    readonly statusCode: number;

    constructor(
        readonly code: InventoryCountErrorCode,
        message?: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message ?? INVENTORY_COUNT_ERROR_MESSAGE[code]);
        this.name = 'InventoryCountError';
        this.statusCode = INVENTORY_COUNT_ERROR_STATUS[code];
    }
}
