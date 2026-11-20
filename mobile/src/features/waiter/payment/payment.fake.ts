import { orderOf, serverItem } from '../order/testkit';
import type { PaymentApi } from './PaymentScreen';

export const httpError = (status: number, message: string) => Object.assign(new Error(String(status)), { response: { status, data: { message } } });
export const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const cents = (n: unknown) => Math.round(Number(n) * 100);
const METHODS = [
    { id: 1, name: 'Efectivo', type: 'CASH', active: true },
    { id: 2, name: 'Tarjeta', type: 'CARD', active: true },
    { id: 3, name: 'Transferencia', type: 'BANK_TRANSFER', active: true },
];
const SHIFT = { hasActiveShift: true, requiresClose: false, shift: { cashRegister: { branch: { id: 1 } } } };

/**
 * A server with memory: the remaining balance shrinks as payments are applied, payments are listed on the order, and a repeated
 * idempotency key replays the first answer (a different body under the same key is rejected, like the real one).
 */
export function makeServer(opts: { lines?: { id: number; name: string; price: number; quantity?: number }[]; taxRate?: number } = {}) {
    const lines = opts.lines ?? [
        { id: 1, name: 'Pizza Margarita', price: 100 },
        { id: 2, name: 'Cola', price: 100 },
    ];
    const taxRate = opts.taxRate ?? 0.15;
    const subtotalCents = lines.reduce((n, l) => n + cents(l.price) * (l.quantity ?? 1), 0);
    const totalCents = Math.round(subtotalCents * (1 + taxRate));
    const state = {
        payments: [] as { id: number; amount: string; status: string; paymentMethodId: number; payerName: string | null }[],
        applied: new Map<string, { body: string; envelope: unknown }>(),
        preinvoiced: false,
        customers: [] as unknown[],
        loseNext: 0,
        /** The request never reaches the server (Wi-Fi drop): nothing is applied and no answer arrives. */
        dropNext: 0,
        tip: 0,
    };
    const paidCents = () => state.payments.reduce((n, p) => n + cents(p.amount), 0);
    const remainingCents = () => totalCents - paidCents();
    const invoiceNumber = () => (remainingCents() === 0 ? 'F-1' : null);

    const distribute = (total: number, n: number) => Array.from({ length: n }, (_, i) => (Math.floor(total / n) + (i < total % n ? 1 : 0)) / 100);

    const api = {
        orderDetail: vi.fn(async () =>
            orderOf(
                lines.map((l) => serverItem(l.id, l.id, l.name, { price: l.price.toFixed(2), quantity: l.quantity ?? 1, subtotal: (l.price * (l.quantity ?? 1)).toFixed(2) })),
                { branchId: 1, tax: ((totalCents - subtotalCents) / 100).toFixed(2), total: (totalCents / 100).toFixed(2), discount: '0.00', tipAmount: state.tip.toFixed(2), preInvoicedAt: state.preinvoiced ? '2026-11-20T10:00:00Z' : null, invoiceNumber: invoiceNumber(), payments: state.payments.map((p) => ({ ...p })) },
            ),
        ),
        paymentMethods: vi.fn(async () => METHODS),
        paymentSummary: vi.fn(async () => ({ remaining: remainingCents() / 100 })),
        cashShiftStatus: vi.fn(async () => SHIFT),
        settings: vi.fn(async () => ({ tipEnabled: 'true', tipRate: '10' })),
        pricing: vi.fn(async (_id: unknown, body: { tipAmount?: number }) => void (state.tip = body.tipAmount ?? state.tip)),
        updateFiscalCustomer: vi.fn(async (_id: unknown, body: unknown) => void state.customers.push(body)),
        preinvoice: vi.fn(async () => void (state.preinvoiced = true)),
        payLeg: vi.fn(async (body: { amount: number; paymentMethodId: number; payerName?: string }, key: string) => {
            const serialized = JSON.stringify(body);
            if (state.dropNext > 0) {
                state.dropNext--;
                throw networkError();
            }
            const prior = state.applied.get(key);
            if (prior) {
                if (prior.body !== serialized) throw httpError(422, 'La llave de idempotencia ya se usó con otros datos');
                return prior.envelope;
            }
            if (cents(body.amount) > remainingCents()) throw httpError(400, 'Amount exceeds remaining balance');
            state.payments.push({ id: state.payments.length + 1, amount: body.amount.toFixed(2), status: 'ACTIVE', paymentMethodId: body.paymentMethodId, payerName: body.payerName ?? null });
            const envelope = { data: { id: state.payments.length }, fiscalInvoice: remainingCents() === 0 ? { invoiceNumber: 'F-1' } : null, fiscalInvoiceError: null };
            state.applied.set(key, { body: serialized, envelope });
            if (state.loseNext > 0) {
                state.loseNext--;
                throw networkError(); // applied, but the answer never arrived
            }
            return envelope;
        }),
        // the real calculators split what is REMAINING, and give a payer who already paid nothing more
        splitEvenly: vi.fn(async (_id: unknown, n: number) => ({ splits: distribute(remainingCents(), n).map((amount) => ({ amount })) })),
        splitByItems: vi.fn(async (_id: unknown, assignments: { personName: string; items: { orderItemId: number; quantity: number }[] }[]) => ({
            splits: assignments.map((a) => {
                const own = a.items.reduce((n, i) => n + Math.round(cents(lines.find((l) => l.id === i.orderItemId)!.price) * i.quantity * (1 + taxRate)), 0);
                const already = state.payments.filter((p) => p.payerName === a.personName).reduce((n, p) => n + cents(p.amount), 0);
                return { personName: a.personName, total: Math.max(0, own - already) / 100 };
            }),
        })),
        splitByAmount: vi.fn(async () => ({ valid: true, splits: [] })),
    };

    return { api: api as unknown as { [K in keyof PaymentApi]: PaymentApi[K] & ReturnType<typeof vi.fn> }, state, remainingCents, totalCents };
}
