import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { hasUsableCashShift } from '@web/utils/paymentAccess';
import { moneyToCents } from '@web/utils/payment';
import { can } from '../../../core/permissions';
import type { LoginUser } from '../../../core/session';
import type { PaymentPlans } from '../../../data/paymentPlans';
import { isOnline } from '../../../data/useOnline';
import type { Json, OrderRef, WaiterApi } from '../../../data/waiterApi';
import { money, normalizeServerLines, type ServerLine } from '../order/orderModel';
import { MixedPayment } from './MixedPayment';
import { PaymentDone, type DoneData } from './PaymentDone';
import { createPaymentFlow, LegError, matchPaidLegs, type ChargeFn, type ChargeMeta, type FiscalCustomer, type FlowApi, type FlowState, type Method, type ModeCtx, type PaymentFlow } from './paymentFlow';
import { PaymentSummary } from './PaymentSummary';
import { SinglePayment } from './SinglePayment';
import { SplitPayment } from './SplitPayment';
import './payment.css';

export type PaymentApi = FlowApi & Pick<WaiterApi, 'orderDetail' | 'paymentMethods' | 'cashShiftStatus' | 'settings' | 'splitEvenly' | 'splitByItems' | 'splitByAmount'>;
export type PaymentMode = 'single' | 'mixed' | 'split';

export interface PaymentScreenProps {
    api: PaymentApi;
    user: LoginUser;
    /** A server id: the order screen never opens payment for an order that exists only in the offline queue. */
    orderId: OrderRef;
    initialMode?: 'single' | 'split';
    /** Where the in-progress plan (mode, split, leg keys) is kept so leaving the screen never loses it. Optional: memory only without it. */
    plans?: PaymentPlans;
    ownerKey?: string | null;
    /** Back to the order (nothing is lost: confirmed legs stay on the server). */
    onClose: () => void;
    /** "Liberar mesa y volver": the server already freed the table on full payment; refresh the lists and leave. */
    onFinished: () => void;
}

interface Loaded {
    order: Json;
    lines: ServerLine[];
    methods: Method[];
    shiftOk: boolean;
    tipRate: number | null;
    remaining: number;
}

const MODES: { id: PaymentMode; label: string }[] = [
    { id: 'single', label: 'Un pago' },
    { id: 'mixed', label: 'Varios métodos' },
    { id: 'split', label: 'Dividir' },
];

const num = (v: unknown) => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const NOT_SYNCED = 'El pedido aún se está sincronizando; cobrar requiere conexión.';

type Meta = Pick<ChargeMeta, 'allIds' | 'changeOf' | 'methodOf' | 'plan'> & { mode: PaymentMode; payable: number };

/** The cashier's payment screen (spec 7.3.1). Only the cashier (payments.process + invoices.issue) gets here. */
export default function PaymentScreen({ api, user, orderId, initialMode = 'single', plans, ownerKey = null, onClose, onFinished }: PaymentScreenProps) {
    const canSplit = can(user, 'bills.split');
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mode, setMode] = useState<PaymentMode>(initialMode === 'split' && !canSplit ? 'single' : initialMode);
    const [payable, setPayable] = useState(0);
    const [paid, setPaid] = useState<string[]>([]);
    const [pending, setPending] = useState<string[]>([]);
    const [attempted, setAttempted] = useState(false);
    const [resumed, setResumed] = useState<{ mode: PaymentMode; plan: unknown } | null>(null);
    const [epoch, setEpoch] = useState(0);
    const [frozen, setFrozen] = useState(false);
    const [customer, setCustomer] = useState<FiscalCustomer | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<DoneData | null>(null);
    const flowRef = useRef<PaymentFlow | null>(null);
    const busyRef = useRef(false);
    const alive = useRef(true);
    const metaRef = useRef<Meta | null>(null);
    const initialTip = useRef(0);
    const id = Number(orderId);

    const allowed = can(user, 'payments.process') && can(user, 'invoices.issue');

    /** Fresh order, payment methods, cash shift, tip setting and what is still owed. */
    const fetchAll = useCallback(async (): Promise<Loaded> => {
        const [order, methodRows, summary, shift, settings] = await Promise.all([
            api.orderDetail(id),
            api.paymentMethods(),
            api.paymentSummary(id),
            api.cashShiftStatus().catch(() => null),
            api.settings().catch(() => null),
        ]);
        const methods = (methodRows as Json[]).filter((m) => m.active !== false).map((m) => ({ id: Number(m.id), name: String(m.name), type: String(m.type) }));
        const branchId = typeof order.branchId === 'number' ? order.branchId : (order.branch?.id ?? user.branchId);
        const tipEnabled = settings?.tipEnabled === true || settings?.tipEnabled === 'true';
        const tipRate = tipEnabled ? num(settings?.tipRate) : null;
        return { order, lines: normalizeServerLines(order), methods, shiftOk: hasUsableCashShift(shift, branchId), tipRate, remaining: num((summary as Json).remaining) };
    }, [api, id, user.branchId]);

    /** Every key change goes to the store together with the mode screen's own state, before the request leaves. */
    const persist = useCallback(
        async (state: FlowState) => {
            const meta = metaRef.current;
            if (!plans || !ownerKey || !meta) return;
            await plans.save(ownerKey, { orderId: id, mode: meta.mode, payable: meta.payable, plan: meta.plan, allIds: meta.allIds, changeOf: meta.changeOf, methodOf: meta.methodOf, legs: state.legs, confirmed: state.confirmed });
        },
        [plans, ownerKey, id],
    );

    const receiptOf = (order: Json, outcome: { fiscalInvoice?: Json | null; fiscalInvoiceError?: string | null } | null, meta: Pick<Meta, 'allIds' | 'changeOf' | 'methodOf'>): DoneData => ({
        tableLabel: order.table?.number ? `Mesa ${order.table.number}` : 'Mesa',
        invoiceNumber: outcome?.fiscalInvoice?.invoiceNumber ? String(outcome.fiscalInvoice.invoiceNumber) : order.invoiceNumber ? String(order.invoiceNumber) : null,
        invoiceError: outcome?.fiscalInvoiceError ?? null,
        methods: [...new Set(meta.allIds.map((leg) => meta.methodOf[leg]).filter(Boolean))].join(' + '),
        change: meta.allIds.reduce((n, leg) => n + (meta.changeOf[leg] ?? 0), 0),
    });

    useEffect(() => {
        alive.current = true;
        if (!allowed) return undefined;
        (async () => {
            const data = await fetchAll();
            const row = plans && ownerKey ? await plans.load(ownerKey, id) : null;
            if (!alive.current) return;
            const preinvoiced = !!(data.order.preInvoicedAt || data.order.invoiceNumber);
            const flow = createPaymentFlow({ api, orderId: id, preinvoiced, resume: row ? { legs: row.legs, confirmed: row.confirmed } : undefined, persist });
            flowRef.current = flow;
            initialTip.current = num(data.order.tipAmount);
            setFrozen(preinvoiced);
            setPayable(data.remaining);
            if (row) {
                metaRef.current = { mode: row.mode, payable: row.payable, plan: row.plan, allIds: row.allIds, changeOf: row.changeOf, methodOf: row.methodOf };
                // legs sent before whose answer was lost: the server's payments say which of them it applied
                await flow.markConfirmed(matchPaidLegs(row.legs, (data.order.payments as Json[]) ?? []));
                if (row.allIds.every((leg) => flow.isConfirmed(leg))) {
                    await plans!.clear(ownerKey!, id);
                    setDone(receiptOf(data.order, null, row));
                } else {
                    setMode(row.mode);
                    setPayable(row.payable);
                    setPaid(flow.confirmedIds());
                    setPending(pendingOf(flow));
                    setAttempted(true);
                    setResumed({ mode: row.mode, plan: row.plan });
                }
            }
            setLoaded(data);
        })().catch((cause) => alive.current && setLoadError(getApiErrorMessage(cause)));
        return () => {
            alive.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per order
    }, [allowed, fetchAll, api, id, plans, ownerKey]);

    if (!allowed) return null; // defence in depth: the entry points already hide Cobrar

    const pendingOf = (flow: PaymentFlow) => Object.keys(flow.state().legs).filter((leg) => !flow.isConfirmed(leg));

    /** One server operation at a time: a double tap on Cobrar (or on the tip) never repeats it. */
    async function exclusive(action: () => Promise<void>): Promise<void> {
        if (busyRef.current) return;
        if (!isOnline()) {
            setError('Cobrar requiere conexión.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (cause) {
            if (!alive.current) return;
            if (cause instanceof Error && cause.name === 'OrderNotSyncedError') setError(NOT_SYNCED);
            else if (cause instanceof LegError) {
                const confirmed = flowRef.current?.confirmedIds().length ?? 0;
                const hint = confirmed > 0 ? ' Los tramos confirmados no se repetirán; toca Cobrar para reintentar solo los pendientes.' : ' Si el cobro llegó a registrarse, no se duplicará al reintentar.';
                setError(`${getApiErrorMessage(cause.cause)}${hint}`);
            } else setError(getApiErrorMessage(cause));
        } finally {
            busyRef.current = false;
            if (alive.current) setBusy(false);
        }
    }

    const refresh = async (force = false) => {
        const data = await fetchAll();
        if (!alive.current) return;
        setLoaded(data);
        if (force || (paid.length === 0 && !attempted)) setPayable(data.remaining);
    };

    const toggleTip = (data: Loaded) =>
        void exclusive(async () => {
            const flow = flowRef.current!;
            const base = data.lines.reduce((n, l) => n + l.subtotal, 0) - num(data.order.discount);
            const on = num(data.order.tipAmount) > 0;
            await flow.setTip(on ? 0 : round2((base * (data.tipRate ?? 0)) / 100));
            await refresh();
        });

    const charge: ChargeFn = (legs, meta) =>
        exclusive(async () => {
            const flow = flowRef.current!;
            const legIds = legs.map((l) => l.id);
            metaRef.current = { mode, payable, plan: meta.plan, allIds: meta.allIds, changeOf: meta.changeOf, methodOf: meta.methodOf };
            await flow.prepare({ customer });
            setFrozen(true);
            // A leg already sent once is replayed first, with its own key and body: if the server applied it, the answer is the
            // receipt, and the remaining balance is no longer the plan's total. The guard is only for legs never attempted.
            if (!flow.hasPending(legIds) && flow.confirmedIds().length === 0) {
                const remaining = await flow.remaining();
                if (moneyToCents(remaining) !== moneyToCents(meta.expected)) {
                    setPayable(remaining);
                    throw new Error(`El total cambió a ${money(remaining)}. Revisa los montos y vuelve a cobrar.`);
                }
            }
            setAttempted(true);
            let outcome;
            try {
                outcome = await flow.pay(legs);
            } finally {
                if (alive.current) {
                    setPaid(flow.confirmedIds());
                    const stillPending = pendingOf(flow);
                    setPending(stillPending);
                    // a definitive rejection leaves nothing behind: the plan can be edited again
                    if (flow.confirmedIds().length === 0 && stillPending.length === 0) setAttempted(false);
                }
            }
            if (alive.current && meta.allIds.every((leg) => flow.isConfirmed(leg))) {
                if (plans && ownerKey) await plans.clear(ownerKey, id);
                setDone(receiptOf(loaded!.order, outcome, meta));
            }
        });

    /** Starts over from what the server says is left; the keys of the discarded plan are dropped. */
    const discard = () =>
        void exclusive(async () => {
            if (plans && ownerKey) await plans.clear(ownerKey, id);
            const old = flowRef.current;
            flowRef.current = createPaymentFlow({ api, orderId: id, preinvoiced: old?.isPrepared() ?? false, persist });
            metaRef.current = null;
            setPaid([]);
            setPending([]);
            setAttempted(false);
            setResumed(null);
            setEpoch((n) => n + 1);
            await refresh(true);
        });

    /** Leaving before any leg was attempted gives the tip back as it was (the toggle wrote it to the order). */
    const leave = async () => {
        const flow = flowRef.current;
        if (flow && loaded && !busyRef.current && !attempted && !flow.isPrepared() && num(loaded.order.tipAmount) !== initialTip.current && isOnline()) {
            busyRef.current = true;
            setBusy(true);
            try {
                await flow.setTip(initialTip.current);
            } catch {
                /* the tip stays; the ticket shows it */
            } finally {
                busyRef.current = false;
            }
        }
        onClose();
    };

    if (loadError) {
        return (
            <main className="pay" data-testid="payment-screen">
                <header className="pay-bar-top">
                    <button type="button" className="btn" aria-label="Volver" onClick={onClose}>
                        ←
                    </button>
                    <strong>Cobrar</strong>
                </header>
                <p className="error pay-notice" role="alert">
                    {loadError}
                </p>
            </main>
        );
    }
    if (!loaded) {
        return (
            <main className="pay" data-testid="payment-screen">
                <p className="muted pay-notice">Cargando cobro…</p>
            </main>
        );
    }
    if (done) return <PaymentDone data={done} onFinish={onFinished} />;

    const { order, lines, methods, shiftOk, tipRate } = loaded;
    const subtotal = lines.reduce((n, l) => n + l.subtotal, 0);
    const tableLabel = order.table?.number ? `Mesa ${order.table.number}` : 'Mesa';
    const ctx: ModeCtx = { methods, shiftOk, payable, charge, busy, locked: attempted, restored: resumed?.mode === mode ? resumed.plan : null, paid, pending, orderId: id, api, lines, onError: setError };
    const customerName = customer?.customerName || (typeof order.customerName === 'string' && order.customerName ? order.customerName : 'Consumidor final');
    const locked = attempted || busy;

    return (
        <main className="pay" data-testid="payment-screen" data-mode={mode}>
            <header className="pay-bar-top" data-fixed={48}>
                <button type="button" className="btn" aria-label="Volver" disabled={busy} onClick={() => void leave()}>
                    ←
                </button>
                <strong className="pay-title">{`Cobrar · ${tableLabel}`}</strong>
                <div className="pay-modes" role="group" aria-label="Modo de cobro">
                    {MODES.filter((m) => m.id !== 'split' || canSplit).map((m) => (
                        <button key={m.id} type="button" className="btn" aria-pressed={mode === m.id} disabled={locked && mode !== m.id} onClick={() => setMode(m.id)}>
                            {m.label}
                        </button>
                    ))}
                </div>
            </header>
            {resumed && (
                <p className="muted pay-notice pay-resumed" role="status">
                    Cobro en curso retomado.{' '}
                    <button type="button" className="btn" disabled={busy} onClick={discard}>
                        Descartar plan
                    </button>
                </p>
            )}
            {error && (
                <p className="error pay-notice" role="alert">
                    {error}
                </p>
            )}
            <div className="pay-body" data-mode={mode}>
                <PaymentSummary
                    lines={lines}
                    subtotal={subtotal}
                    discount={num(order.discount)}
                    tax={num(order.tax)}
                    tip={num(order.tipAmount)}
                    total={payable}
                    customerName={customerName}
                    frozen={frozen}
                    tipRate={tipRate}
                    tipOn={num(order.tipAmount) > 0}
                    busy={busy}
                    onToggleTip={() => toggleTip(loaded)}
                    onCustomer={setCustomer}
                />
                {mode === 'single' && <SinglePayment key={`single-${epoch}`} ctx={ctx} />}
                {mode === 'mixed' && <MixedPayment key={`mixed-${epoch}`} ctx={ctx} />}
                {mode === 'split' && <SplitPayment key={`split-${epoch}`} ctx={ctx} />}
            </div>
        </main>
    );
}
