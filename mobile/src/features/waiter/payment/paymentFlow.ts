import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '@web/utils/idempotency';
import { centsToMoney, moneyToCents } from '@web/utils/payment';
import type { Json, OrderRef, WaiterApi } from '../../../data/waiterApi';

export type FlowApi = Pick<WaiterApi, 'pricing' | 'updateFiscalCustomer' | 'preinvoice' | 'paymentSummary' | 'payLeg'>;

/** One charge. `id` is stable for the life of the screen: it owns the leg's idempotency key and its "confirmed" mark. */
export interface Leg {
    id: string;
    paymentMethodId: number;
    amount: number;
    reference?: string;
    payerName?: string;
}

export interface FiscalCustomer {
    customerName: string;
    customerTaxId?: string;
    customerTaxIdType?: string;
    customerFiscalAddress?: string;
    customerEmail?: string;
    customerPhone?: string;
}

export interface PrepareInput {
    /** null = keep "Consumidor final" / the customer the order already has. */
    customer: FiscalCustomer | null;
}

export interface LegOutcome {
    fiscalInvoice: Json | null;
    fiscalInvoiceError: string | null;
}

/** A leg failed: the ones before it are confirmed and stay confirmed. */
export class LegError extends Error {
    constructor(
        readonly legId: string,
        readonly cause: unknown,
    ) {
        super(cause instanceof Error ? cause.message : 'No se pudo procesar el pago.');
        this.name = 'LegError';
    }
}

/** Change to hand back, in integer cents so 0.3 - 0.1 is 0.2. Never negative. */
export function cashChange(received: number, due: number): number {
    return centsToMoney(Math.max(0, moneyToCents(received) - moneyToCents(due)));
}

const BILLS = [50, 100, 500, 1000];

/** "Exacto" plus up to three round amounts above the balance (the bills a customer would hand over). */
export function quickAmounts(balance: number): number[] {
    const cents = moneyToCents(balance);
    const above = BILLS.map((b) => Math.ceil(cents / (b * 100)) * b * 100)
        .filter((c) => c > cents)
        .map(centsToMoney);
    return [balance, ...[...new Set(above)].sort((a, b) => a - b).slice(0, 3)];
}

export const isCashType = (type: unknown) => type === 'CASH';

const fingerprintOf = (leg: Leg) => JSON.stringify([leg.paymentMethodId, moneyToCents(leg.amount), leg.reference ?? '', leg.payerName ?? '']);

export interface FlowOptions {
    api: FlowApi;
    orderId: OrderRef;
    /** The order already carries a pre-invoice (a payment was attempted before): tip, customer and pre-invoice are frozen. */
    preinvoiced?: boolean;
}

/**
 * The payment protocol, free of UI (mirrors PaymentModal / POS.tsx): optional tip, fiscal customer and the pre-invoice
 * (each at most once, failed steps retried alone), then one POST /payments per leg in order. A confirmed leg is never
 * sent again; a pending leg keeps its key across retries and gets a fresh one only after a definitive rejection or when
 * its data changed (same key + different data is an error server-side).
 */
export function createPaymentFlow({ api, orderId, preinvoiced = false }: FlowOptions) {
    const done = { customer: preinvoiced, preinvoice: preinvoiced };
    let tipApplied: number | null = null;
    const confirmed: string[] = [];
    const attempts = new Map<string, IdempotentAttempt>();
    const inflight = new Map<string, Promise<LegOutcome>>();

    /**
     * Step 1, optional: the tip lives on the order and changes its total, so it is written as soon as the cashier picks it
     * (before any split preview) and never again once the pre-invoice froze the order.
     */
    async function setTip(tipAmount: number): Promise<void> {
        if (done.preinvoice) throw new Error('La cuenta ya fue prefacturada; la propina no puede cambiar.');
        if (tipApplied === tipAmount) return;
        await api.pricing(orderId, { tipAmount });
        tipApplied = tipAmount;
    }

    /** Steps 2 and 3: fiscal customer (only when the cashier captured one) and the pre-invoice, each at most once. */
    async function prepare(input: PrepareInput): Promise<void> {
        if (!done.customer) {
            if (input.customer) await api.updateFiscalCustomer(orderId, input.customer);
            done.customer = true;
        }
        if (!done.preinvoice) {
            await api.preinvoice(orderId);
            done.preinvoice = true;
        }
    }

    function send(leg: Leg): Promise<LegOutcome> {
        const running = inflight.get(leg.id);
        if (running) return running;
        const attempt = getIdempotentAttempt(attempts.get(leg.id) ?? null, fingerprintOf(leg));
        attempts.set(leg.id, attempt);
        const body = {
            orderId,
            paymentMethodId: leg.paymentMethodId,
            amount: leg.amount,
            ...(leg.reference ? { reference: leg.reference } : {}),
            ...(leg.payerName ? { payerName: leg.payerName } : {}),
        };
        const promise = api
            .payLeg(body, attempt.key)
            .then((res) => {
                confirmed.push(leg.id);
                attempts.delete(leg.id);
                return { fiscalInvoice: res.fiscalInvoice ?? null, fiscalInvoiceError: res.fiscalInvoiceError ?? null };
            })
            .catch((cause: unknown) => {
                // Only an ambiguous failure may have been applied: its key stays for the retry.
                if (!isAmbiguousMutationFailure(cause)) attempts.delete(leg.id);
                throw new LegError(leg.id, cause);
            })
            .finally(() => inflight.delete(leg.id));
        inflight.set(leg.id, promise);
        return promise;
    }

    /** Charges the pending legs one after another; stops at the first failure. Resolves with the outcome of the last leg. */
    async function pay(legs: Leg[]): Promise<LegOutcome> {
        let last: LegOutcome = { fiscalInvoice: null, fiscalInvoiceError: null };
        for (const leg of legs) {
            if (confirmed.includes(leg.id)) continue;
            last = await send(leg);
        }
        return last;
    }

    return {
        setTip,
        prepare,
        isPrepared: () => done.preinvoice,
        pay,
        isConfirmed: (id: string) => confirmed.includes(id),
        confirmedIds: () => [...confirmed],
        /** Amount still owed according to the server (authoritative; the screen only previews). */
        remaining: async (): Promise<number> => {
            const id = typeof orderId === 'number' ? orderId : Number(orderId);
            return Number((await api.paymentSummary(id)).remaining) || 0;
        },
    };
}

export type PaymentFlow = ReturnType<typeof createPaymentFlow>;

// ---- shared shapes of the payment screens ----

export interface Method {
    id: number;
    name: string;
    type: string;
}

/** What a charge request tells the screen about the plan it belongs to (to detect "everything paid" and build the receipt). */
export interface ChargeMeta {
    /** Every leg of the plan, this one included. */
    allIds: string[];
    /** Money to hand back per leg (cash received minus amount). */
    changeOf: Record<string, number>;
    /** Method name per leg, for the receipt. */
    methodOf: Record<string, string>;
    /** What the legs of the plan still pending must add up to: it must equal the server's remaining before the first leg. */
    expected: number;
}

export type ChargeFn = (legs: Leg[], meta: ChargeMeta) => Promise<void>;

/** What PaymentScreen hands every mode. */
export interface ModeCtx {
    methods: Method[];
    /** The user has an open cash shift of today in the order's branch. */
    shiftOk: boolean;
    /** What is still owed (server authority). */
    payable: number;
    charge: ChargeFn;
    busy: boolean;
    /** Legs the server confirmed. */
    paid: string[];
    /** Server-side text of the last failure, shown by the screen. */
    orderId: OrderRef;
    api: Pick<WaiterApi, 'splitEvenly' | 'splitByItems' | 'splitByAmount'>;
    lines: import('../order/orderModel').ServerLine[];
    onError: (message: string | null) => void;
}
