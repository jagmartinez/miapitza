import { useState } from 'react';
import { calculateAutomaticPaymentRemainder, canUsePaymentMethodInMixed, moneyToCents, summarizePaymentAllocation, splitTotalEvenly } from '@web/utils/payment';
import { money } from '../order/orderModel';
import { ChargeButton, Keypad, parseTyped, typeKey } from './controls';
import { cashChange, isCashType, type Leg, type ModeCtx } from './paymentFlow';

interface Row {
    id: string;
    methodId: number;
    amount: string; // typed; the last row ignores it (it owns the remainder)
    reference: string;
    received: string; // cash legs: what the customer handed over; '' = exact
}

const MAX_LEGS = 3;

export function MixedPayment({ ctx }: { ctx: ModeCtx }) {
    const { methods, shiftOk, payable, busy, paid } = ctx;
    const usable = methods.filter((m) => canUsePaymentMethodInMixed(m.type, shiftOk));
    const saved = (ctx.restored ?? null) as { rows: Row[]; counter: number } | null;
    const [rows, setRows] = useState<Row[]>(() => {
        if (saved) return saved.rows;
        const [a, b] = usable;
        if (!a || !b) return [];
        const [first] = splitTotalEvenly(payable, 2);
        return [
            { id: 'mix-1', methodId: a.id, amount: String(first), reference: '', received: '' },
            { id: 'mix-2', methodId: b.id, amount: '', reference: '', received: '' },
        ];
    });
    const [selected, setSelected] = useState(0);
    const [counter, setCounter] = useState(saved?.counter ?? 3);
    const locked = ctx.locked;

    if (rows.length < 2) {
        return (
            <section className="pay-col pay-center pay-wide" aria-label="Varios métodos">
                <p className="muted" role="status">
                    Se necesitan al menos dos métodos de pago disponibles (tarjeta, transferencia o efectivo con turno abierto) para cobrar con varios métodos.
                </p>
            </section>
        );
    }

    const last = rows.length - 1;
    const typedAmounts = rows.slice(0, last).map((r) => parseTyped(r.amount));
    const remainder = calculateAutomaticPaymentRemainder(payable, typedAmounts).amount;
    const amountOf = (i: number) => (i === last ? remainder : (typedAmounts[i] ?? 0));
    const amounts = rows.map((_, i) => amountOf(i));
    const allocation = summarizePaymentAllocation(payable, amounts);
    const assigned = amounts.reduce((n, a) => n + a, 0);
    const missing = Math.max(0, payable - assigned);
    const methodIds = rows.map((r) => r.methodId);
    const typeOf = (methodId: number) => methods.find((m) => m.id === methodId)?.type;
    /** What the customer handed over for a cash leg ('' = exactly the leg). */
    const receivedOf = (r: Row, i: number) => (r.received === '' ? amounts[i] : (parseTyped(r.received) ?? 0));
    const cashShort = rows.some((r, i) => isCashType(typeOf(r.methodId)) && !paid.includes(r.id) && moneyToCents(receivedOf(r, i)) < moneyToCents(amounts[i]));
    const valid = amounts.every((a) => a > 0) && allocation.exact && new Set(methodIds).size === methodIds.length && !cashShort;
    const pending = rows.reduce((n, r, i) => (paid.includes(r.id) ? n : n + amounts[i]), 0); // legs still to charge (a retry after a drop)
    const nameOf = (id: number) => methods.find((m) => m.id === id)?.name ?? '';

    const patch = (index: number, change: Partial<Row>) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, ...change } : r)));
    const add = () => {
        const free = usable.find((m) => !methodIds.includes(m.id));
        if (!free || rows.length >= MAX_LEGS) return;
        setRows((cur) => [...cur, { id: `mix-${counter}`, methodId: free.id, amount: '', reference: '', received: '' }]);
        setCounter((n) => n + 1);
    };
    const remove = (index: number) => {
        setRows((cur) => cur.filter((_, i) => i !== index));
        setSelected(0);
    };

    const legs: Leg[] = rows.map((r, i) => ({
        id: r.id,
        paymentMethodId: r.methodId,
        amount: amounts[i],
        ...(!isCashType(methods.find((m) => m.id === r.methodId)?.type) && r.reference.trim() ? { reference: r.reference.trim() } : {}),
    }));
    const charge = () => {
        if (!valid || busy) return;
        void ctx.charge(legs, {
            allIds: rows.map((r) => r.id),
            changeOf: Object.fromEntries(rows.map((r, i) => [r.id, isCashType(typeOf(r.methodId)) ? cashChange(receivedOf(r, i), amounts[i]) : 0])),
            plan: { rows, counter },
            methodOf: Object.fromEntries(rows.map((r) => [r.id, nameOf(r.methodId)])),
            expected: payable,
        });
    };

    return (
        <>
            <section className="pay-col pay-center pay-legs" aria-label="Tramos">
                {rows.map((r, i) => {
                    const done = paid.includes(r.id);
                    const isLast = i === last;
                    const method = methods.find((m) => m.id === r.methodId);
                    return (
                        <div key={r.id} className="pay-leg" data-selected={selected === i} data-paid={done}>
                            <div className="pay-leg-row">
                                <label className="pay-leg-method">
                                    <span className="muted">{`Tramo ${i + 1}`}</span>
                                    <select aria-label={`Método del tramo ${i + 1}`} value={r.methodId} disabled={done || locked} onChange={(e) => patch(i, { methodId: Number(e.target.value) })}>
                                        {usable.map((m) => (
                                            <option key={m.id} value={m.id} disabled={methodIds.includes(m.id) && m.id !== r.methodId}>
                                                {m.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <button type="button" className="btn pay-leg-amount" aria-label={`Monto del tramo ${i + 1}`} aria-pressed={selected === i} disabled={done || locked || isLast} onClick={() => setSelected(i)}>
                                    {money(amounts[i])}
                                </button>
                                {done ? (
                                    <span className="pay-paid">Pagado</span>
                                ) : (
                                    rows.length > 2 &&
                                    !locked && (
                                        <button type="button" className="btn icon-btn" aria-label={`Quitar tramo ${i + 1}`} onClick={() => remove(i)}>
                                            ✕
                                        </button>
                                    )
                                )}
                            </div>
                            {isLast && !done && <span className="muted">Resto automático</span>}
                            {method && isCashType(method.type) && !done && (
                                <div className="pay-leg-cash">
                                    <input className="pay-ref" aria-label={`Recibido del tramo ${i + 1}`} inputMode="decimal" placeholder="Recibido (exacto)" value={r.received} onChange={(e) => patch(i, { received: e.target.value.replace(/[^\d.]/g, '') })} />
                                    {amounts[i] > 0 && receivedOf(r, i) > amounts[i] && <span className="pay-change">{`Cambio ${money(cashChange(receivedOf(r, i), amounts[i]))}`}</span>}
                                </div>
                            )}
                            {method && !isCashType(method.type) && !done && (
                                <input className="pay-ref" aria-label={`Referencia del tramo ${i + 1}`} placeholder="Referencia" disabled={ctx.pending.includes(r.id)} value={r.reference} maxLength={191} onChange={(e) => patch(i, { reference: e.target.value })} />
                            )}
                        </div>
                    );
                })}
                {!locked && rows.length < MAX_LEGS && usable.some((m) => !methodIds.includes(m.id)) && (
                    <button type="button" className="btn" onClick={add}>
                        + Agregar método
                    </button>
                )}
                <div className="pay-bar" role="status" aria-label="Asignado y falta">
                    <div className="pay-bar-track">
                        <div className="pay-bar-fill" style={{ width: `${payable > 0 ? Math.min(100, (assigned / payable) * 100) : 0}%` }} />
                    </div>
                    <span>{`Asignado ${money(assigned)}`}</span>
                    <span className={missing > 0 ? 'pay-missing' : 'muted'}>{`Falta ${money(missing)}`}</span>
                </div>
            </section>
            <section className="pay-col pay-right" aria-label="Monto del tramo">
                <div className="pay-readout">
                    <div>
                        <span className="muted">{`Tramo ${selected + 1}`}</span>
                        <strong>{money(amounts[selected] ?? 0)}</strong>
                    </div>
                </div>
                <Keypad disabled={locked || selected === last} onKey={(k) => patch(selected, { amount: typeKey(rows[selected].amount, k) })} />
            </section>
            <ChargeButton amount={pending} disabled={!valid || busy} onClick={charge} />
        </>
    );
}
