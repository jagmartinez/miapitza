/** Wire types of the caja API. Fields the server redacts for a blind cashier (open shift) are optional: never compute them client-side. */

export type CashErrorCode =
    | 'CASH_SHIFT_ALREADY_OPEN'
    | 'CASH_REGISTER_OCCUPIED'
    | 'CASH_COUNT_MISMATCH'
    | 'CASH_EXCHANGE_RATE_REQUIRED'
    | 'CASH_INVALID_BREAKDOWN'
    | 'CASH_NOTE_REQUIRED'
    | 'CASH_DIFF_EXCEEDS_TOLERANCE'
    | 'CASH_SHIFT_ALREADY_CLOSED'
    /** Client side: cash calls need a connection and are never queued. */
    | 'CASH_OFFLINE';

export const CASH_ERROR_CODES: ReadonlySet<string> = new Set<CashErrorCode>([
    'CASH_SHIFT_ALREADY_OPEN',
    'CASH_REGISTER_OCCUPIED',
    'CASH_COUNT_MISMATCH',
    'CASH_EXCHANGE_RATE_REQUIRED',
    'CASH_INVALID_BREAKDOWN',
    'CASH_NOTE_REQUIRED',
    'CASH_DIFF_EXCEEDS_TOLERANCE',
    'CASH_SHIFT_ALREADY_CLOSED',
]);

export class CashError extends Error {
    constructor(
        readonly code: CashErrorCode,
        message: string,
        readonly extras: { occupiedBy?: { id: number; name: string }; closedByMe?: boolean; status?: number } = {},
    ) {
        super(message);
        this.name = 'CashError';
    }
    get occupiedBy() {
        return this.extras.occupiedBy;
    }
    get closedByMe() {
        return this.extras.closedByMe;
    }
}

export interface CashRegisterRow {
    id: number;
    name: string;
    branchId: number;
    branch?: { id: number; name: string; code?: string };
    status: 'OPEN' | 'CLOSED';
    activeShift: { id: number; startDate: string; userId: number; user?: { id: number; name: string } } | null;
}

export interface CashShiftInfo {
    id: number;
    cashRegisterId: number;
    userId: number;
    startDate: string;
    endDate: string | null;
    startAmount: number | string;
    cashRegister?: { id: number; name: string; branch?: { id: number; name: string } };
    user?: { id: number; name: string };
    [extra: string]: unknown;
}

export interface ActiveShiftStatus {
    hasActiveShift: boolean;
    shift: CashShiftInfo | null;
    requiresClose: boolean;
    message: string | null;
}

export interface SuggestedFloat {
    suggested: number | null;
    fromShiftId: number | null;
}

export interface CashSettings {
    exchangeRateUsd: number;
    tolerance: number;
}

export interface ShiftSummary {
    shift: CashShiftInfo & { movements?: CashMovementRow[] };
    summary: {
        startAmount: number;
        totalIn: number;
        totalOut: number;
        grossSalesCash: number;
        cashRefunds: number;
        totalSalesCash: number;
        otherIncome: number;
        otherOutflows: number;
        movementCount: number;
        /** Sales of the shift by payment method, when the server provides them (cash sales are always in totalSalesCash). */
        salesByMethod?: { cash: number; card: number; transfer: number; paymentCount: number };
        /** Omitted for a blind cashier while the shift is open. */
        expectedBalance?: number;
        expectedAmount?: number;
        actualBalance?: number | null;
        difference?: number | null;
    };
}

export interface CashMovementRow {
    id: number;
    type: 'IN' | 'OUT';
    amount: number | string;
    description?: string | null;
    reference?: string | null;
    documentType?: string | null;
    createdAt: string;
}

export interface MovementInput {
    type: 'IN' | 'OUT';
    amount: number;
    documentType?: 'FACTURA' | 'RECIBO_GASTO' | 'RECIBO_CAJA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
    description: string;
    /** Why the money moved. Folded into `description` (the server rejects unknown keys and `reference` is for document refs). */
    reason?: string;
    documentNumber?: string;
    documentDate?: string;
    supplierId?: number;
}

export interface CountRow {
    denomination: number;
    count: number;
}

export interface CountBody {
    bills: CountRow[];
    coins: CountRow[];
    usdBills?: CountRow[];
    exchangeRate?: number;
}

export interface ClosePayload extends CountBody {
    endAmount: number;
    notes?: string;
    forceClose?: boolean;
}

export interface CountResult {
    counted: { bills: number; coins: number; usdBills: number; usdInCordobas: number; total: number };
    status?: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
    withinTolerance?: boolean;
    /** Omitted for a blind cashier. */
    expected?: number;
    difference?: number;
}

export interface ClosePreview {
    countedAmount: number;
    countedBreakdown: { bills: number; coins: number; usdBills: number; usdInCordobas: number; exchangeRate: number };
    notes: string;
    status?: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
    withinTolerance?: boolean;
    requiresNote?: boolean;
    exceedsTolerance?: boolean;
    tolerance?: number;
    /** Omitted for a blind cashier. */
    expectedAmount?: number;
    difference?: number;
    absoluteDifference?: number;
}

export interface ShiftReport {
    shift: Record<string, unknown>;
    amounts: Record<string, number | null | undefined>;
    movements: { in: unknown[]; out: unknown[] };
    counts: { bills: unknown[]; coins: unknown[]; usdBills: unknown[] };
    reconciliation: { isBalanced?: boolean; surplus?: number; deficit?: number };
    report: { title: string; generatedAt: string; summary: string };
}

export type CloseResult = { alreadyClosed: false; shift: CashShiftInfo } | { alreadyClosed: true };

export interface HistoryQuery {
    registerId?: number;
    from?: string;
    to?: string;
}
