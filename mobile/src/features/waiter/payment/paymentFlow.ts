import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '@web/utils/idempotency';
import { centsToMoney, moneyToCents, splitTotalEvenly } from '@web/utils/payment';
import type { PlanLeg } from '../../../data/types';
import type { Json, OrderRef, WaiterApi } from '../../../data/waiterApi';

export type FlowApi = Pick<WaiterApi, 'pricing' | 'updateFiscalCustomer' | 'preinvoice' | 'paymentSummary' | 'payLeg'>;

/** One charge. `id` is stable for the life of the plan: it owns the leg's idempotency key and its "confirmed" mark. */
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

/** What survives a screen: the key of every attempted leg (with what was sent under it) and the confirmed legs. */
export interface FlowState {
    legs: Record<string, PlanLeg>;
    confirmed: string[];
}

export interface FlowOptions {
    api: FlowApi;
    orderId: OrderRef;
    /** The order already carries a pre-invoice (a payment was attempted before): tip, customer and pre-invoice are frozen. */
    preinvoiced?: boolean;
    /** A plan saved by an earlier screen: its attempted legs keep their keys and its confirmed legs are never sent again. */
    resume?: FlowState;
    /** Called (and awaited) every time the keys change; a key is stored before its request leaves. */
    persist?: (state: FlowState) => Promise<void> | void;
}

const centsOf = (v: unknown) => Math.round(Number(v) * 100);
const payerKey = (name: unknown) => (typeof name === 'string' ? name.trim().toLocaleLowerCase('es-NI') : '');

/**
 * Which attempted legs the server already has: an ACTIVE payment with the same payer, amount (cents) and method, each
 * payment used once. This is how a leg whose answer was lost shows as paid on re-entry without sending it again.
 */
export function matchPaidLegs(legs: Record<string, PlanLeg>, payments: Json[]): string[] {
    const free = payments.filter((p) => !p.status || p.status === 'ACTIVE');
    const out: string[] = [];
    for (const [id, leg] of Object.entries(legs)) {
        const at = free.findIndex((p) => centsOf(p.amount) === centsOf(leg.spec.amount) && Number(p.paymentMethodId) === leg.spec.paymentMethodId && payerKey(p.payerName) === payerKey(leg.spec.payerName));
        if (at >= 0) {
            free.splice(at, 1);
            out.push(id);
        }
    }
    return out;
}

/** `total` in `count` legs, in cents; the last legs take the odd cents (100.00 / 3 = 33.33, 33.33, 33.34). */
export const evenLegAmounts = (total: number, count: number): number[] => splitTotalEvenly(total, count);

/**
 * The payment protocol, free of UI (mirrors PaymentModal / POS.tsx): optional tip, fiscal customer and the pre-invoice,
 * then one POST /payments per leg in order. A confirmed leg is never sent again; a pending leg keeps its key across
 * retries (and across screens, through `persist`/`resume`) and gets a fresh one only after a definitive rejection or when
 * its data changed (same key + different data is an error server-side).
 */
export function createPaymentFlow({ api, orderId, preinvoiced = false, resume, persist }: FlowOptions) {
    const done = { preinvoice: preinvoiced };
    /** The customer the server holds from OUR last successful PATCH; a different one is sent again before the pre-invoice. */
    let customerSent: string | null = null;
    let tipApplied: number | null = null;
    const confirmed: string[] = [...(resume?.confirmed ?? [])];
    const attempts = new Map<string, IdempotentAttempt & { spec: PlanLeg['spec'] }>(Object.entries(resume?.legs ?? {}).map(([id, l]) => [id, { key: l.key, fingerprint: l.fingerprint, spec: l.spec }]));
    const inflight = new Map<string, Promise<LegOutcome>>();

    const snapshot = (): FlowState => ({
        legs: Object.fromEntries([...attempts].map(([id, a]) => [id, { key: a.key, fingerprint: a.fingerprint, spec: a.spec }])),
        confirmed: [...confirmed],
    });
    const save = async () => {
        try {
            await persist?.(snapshot());
        } catch {
            /* memory only */
        }
    };

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

    /** Steps 2 and 3: the fiscal customer (whenever it differs from the one last sent) and the pre-invoice, once. */
    async function prepare(input: PrepareInput): Promise<void> {
        if (done.preinvoice) return;
        const wanted = input.customer ? JSON.stringify(input.customer) : null;
        if (input.customer && wanted !== customerSent) {
            await api.updateFiscalCustomer(orderId, input.customer);
            customerSent = wanted;
        }
        await api.preinvoice(orderId);
        done.preinvoice = true;
    }

    function send(leg: Leg): Promise<LegOutcome> {
        const running = inflight.get(leg.id);
        if (running) return running;
        const attempt = getIdempotentAttempt(attempts.get(leg.id) ?? null, fingerprintOf(leg));
        const spec = { paymentMethodId: leg.paymentMethodId, amount: leg.amount, ...(leg.payerName ? { payerName: leg.payerName } : {}), ...(leg.reference ? { reference: leg.reference } : {}) };
        attempts.set(leg.id, { ...attempt, spec });
        const body = {
            orderId,
            paymentMethodId: leg.paymentMethodId,
            amount: leg.amount,
            ...(leg.reference ? { reference: leg.reference } : {}),
            ...(leg.payerName ? { payerName: leg.payerName } : {}),
        };
        const promise = (async () => {
            await save(); // the key is stored before the request leaves
            try {
                const res = await api.payLeg(body, attempt.key);
                confirmed.push(leg.id);
                attempts.delete(leg.id);
                await save();
                return { fiscalInvoice: res.fiscalInvoice ?? null, fiscalInvoiceError: res.fiscalInvoiceError ?? null };
            } catch (cause: unknown) {
                // Only an ambiguous failure may have been applied: its key stays for the retry.
                if (!isAmbiguousMutationFailure(cause)) {
                    attempts.delete(leg.id);
                    await save();
                }
                throw new LegError(leg.id, cause);
            } finally {
                inflight.delete(leg.id);
            }
        })();
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
        /** Some of these legs were already sent once and not confirmed: replay them (same key, same body) before anything else. */
        hasPending: (ids: string[]) => ids.some((id) => attempts.has(id) && !confirmed.includes(id)),
        /** The server shows these legs as paid (see matchPaidLegs): they are never sent again. */
        markConfirmed: async (ids: string[]) => {
            for (const id of ids) {
                if (!confirmed.includes(id)) confirmed.push(id);
                attempts.delete(id);
            }
            if (ids.length > 0) await save();
        },
        state: snapshot,
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
    /** The mode screen's own state (people, amounts), saved with the keys so a later screen can resume it. */
    plan: unknown;
}

export type ChargeFn = (legs: Leg[], meta: ChargeMeta) => Promise<void>;

/** What PaymentScreen hands every mode. */
export interface ModeCtx {
    methods: Method[];
    /** The user has an open cash shift of today in the order's branch. */
    shiftOk: boolean;
    /** What is still owed (server authority) or, once a leg was attempted, what the plan adds up to. */
    payable: number;
    charge: ChargeFn;
    busy: boolean;
    /** A leg was attempted (or the plan was resumed): the plan is frozen, only its pending legs can be sent. */
    locked: boolean;
    /** The saved state of this mode when the plan was resumed. */
    restored: unknown;
    /** Legs the server confirmed. */
    paid: string[];
    /** Legs already sent once without a confirmed answer: what they were sent with can no longer change. */
    pending: string[];
    orderId: OrderRef;
    api: Pick<WaiterApi, 'splitEvenly' | 'splitByItems' | 'splitByAmount'>;
    lines: import('../order/orderModel').ServerLine[];
    onError: (message: string | null) => void;
}
