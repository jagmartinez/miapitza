/**
 * Typed business errors of the kitchen (KDS) batch operations. The Spanish
 * `message` is what the operator sees; `code` is the stable machine
 * identifier clients (web and the Android kitchen tablet) branch on. The
 * central error handler echoes `code` and `statusCode` from the error.
 */
export type KitchenErrorCode =
    | 'KITCHEN_BATCH_NOT_FOUND'
    | 'KITCHEN_BATCH_RELEASED'
    | 'KITCHEN_BATCH_NOT_READY'
    | 'KITCHEN_NOTHING_PENDING'
    | 'KITCHEN_INVALID_STATE';

const KITCHEN_ERROR_STATUS: Record<KitchenErrorCode, number> = {
    KITCHEN_BATCH_NOT_FOUND: 404,
    KITCHEN_BATCH_RELEASED: 409,
    KITCHEN_BATCH_NOT_READY: 409,
    KITCHEN_NOTHING_PENDING: 409,
    KITCHEN_INVALID_STATE: 409,
};

export class KitchenError extends Error {
    readonly statusCode: number;

    constructor(message: string, readonly code: KitchenErrorCode) {
        super(message);
        this.name = 'KitchenError';
        this.statusCode = KITCHEN_ERROR_STATUS[code];
    }
}
