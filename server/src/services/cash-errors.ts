/**
 * Typed business errors of the cash (caja) domain. The Spanish `message` is
 * what the operator sees; `code` is the stable machine identifier clients
 * (web and the Android tablet) branch on. `extras` are merged into the JSON
 * body by the central error handler.
 */
export type CashErrorCode =
    | 'CASH_SHIFT_ALREADY_OPEN'
    | 'CASH_REGISTER_OCCUPIED'
    | 'CASH_COUNT_MISMATCH'
    | 'CASH_EXCHANGE_RATE_REQUIRED'
    | 'CASH_INVALID_BREAKDOWN'
    | 'CASH_NOTE_REQUIRED'
    | 'CASH_DIFF_EXCEEDS_TOLERANCE'
    | 'CASH_SHIFT_ALREADY_CLOSED';

export class CashError extends Error {
    constructor(
        message: string,
        readonly statusCode: number,
        readonly code: CashErrorCode,
        readonly extras?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'CashError';
    }
}
