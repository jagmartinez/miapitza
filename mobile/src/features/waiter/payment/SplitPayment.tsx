import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { hasUniqueNormalizedPayerNames, moneyToCents, normalizePayerName, summarizePaymentAllocation } from '@web/utils/payment';
import { money, type ServerLine } from '../order/orderModel';
import { parseTyped } from './controls';
import { cashChange, isCashType, type Leg, type ModeCtx } from './paymentFlow';
import { firstUsable } from './SinglePayment';

type Strategy = 'evenly' | 'items' | 'amount';

interface Person {
    id: string;
    name: string;
    methodId: number | null;
    reference: string;
    received: string; // '' = exact
    amountText: string; // by-amount
}

const MAX_PEOPLE = 12;
const STRATEGIES: { id: Strategy; label: string }[] = [
    { id: 'evenly', label: 'Iguales' },
    { id: 'items', label: 'Por productos' },
    { id: 'amount', label: 'Por monto' },
];

const emptyOwners = (line: ServerLine): (string | null)[] => Array<string | null>(line.quantity).fill(null);

export function SplitPayment({ ctx }: { ctx: ModeCtx }) {
    const { methods, shiftOk, payable, busy, paid, lines, orderId, api, onError } = ctx;
    const defaultMethod = firstUsable(methods, shiftOk);
    const makePerson = (n: number): Person => ({ id: `p${n}`, name: `Persona ${n}`, methodId: defaultMethod, reference: '', received: '', amountText: '' });
    const saved = (ctx.restored ?? null) as { persons: Person[]; counter: number; strategy: Strategy; owners: Record<number, (string | null)[]>; shares: Record<string, number>; shareSig: string } | null;
    const [persons, setPersons] = useState<Person[]>(() => saved?.persons ?? [makePerson(1), makePerson(2)]);
    const [counter, setCounter] = useState(saved?.counter ?? 3);
    const [strategy, setStrategy] = useState<Strategy>(saved?.strategy ?? 'items');
    const [owners, setOwners] = useState<Record<number, (string | null)[]>>(saved?.owners ?? {});
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const [shares, setShares] = useState<Record<string, number>>(saved?.shares ?? {});
    const [shareSig, setShareSig] = useState(saved?.shareSig ?? '');
    const seq = useRef(0);
    // once a leg was attempted the plan is fixed: the calculators would now split what is left, not the original bill
    const locked = ctx.locked;

    const ownersOf = (line: ServerLine) => owners[line.id] ?? emptyOwners(line);
    const namesUnique = hasUniqueNormalizedPayerNames(persons.map((p) => p.name));
    const allAssigned = lines.length > 0 && lines.every((l) => ownersOf(l).every((o) => o !== null)) && persons.every((p) => lines.some((l) => ownersOf(l).includes(p.id)));

    const assignments = useMemo(
        () =>
            persons.map((p) => ({
                personName: normalizePayerName(p.name),
                items: lines.map((l) => ({ orderItemId: l.id, quantity: (owners[l.id] ?? emptyOwners(l)).filter((o) => o === p.id).length })).filter((i) => i.quantity > 0),
            })),
        [persons, lines, owners],
    );
    const itemsSig = JSON.stringify(assignments);
    const evenSig = `${persons.length}|${payable}`;
    const amountSig = JSON.stringify(persons.map((p) => [normalizePayerName(p.name), p.amountText]));

    // Amounts per person come from the server's calculators (previews: nothing is stored). A new request makes older ones stale.
    useEffect(() => {
        if (locked) return undefined;
        const mine = ++seq.current;
        const fail = (cause: unknown) => {
            if (mine !== seq.current) return;
            setShares({});
            setShareSig('');
            onError(getApiErrorMessage(cause));
        };
        const ok = (next: Record<string, number>, sig: string) => {
            if (mine !== seq.current) return;
            setShares(next);
            setShareSig(sig);
            onError(null);
        };
        if (strategy === 'evenly' && persons.length >= 2) {
            api.splitEvenly(orderId, persons.length).then((res) => {
                const list = ((res as { splits?: { amount: unknown }[] }).splits ?? []).map((s) => Number(s.amount));
                ok(Object.fromEntries(persons.map((p, i) => [p.id, list[i] ?? 0])), evenSig);
            }, fail);
        } else if (strategy === 'items' && allAssigned && namesUnique) {
            api.splitByItems(orderId, assignments).then((res) => {
                const byName = new Map(((res as { splits?: { personName: string; total: unknown }[] }).splits ?? []).map((s) => [s.personName, Number(s.total)]));
                ok(Object.fromEntries(persons.map((p) => [p.id, byName.get(normalizePayerName(p.name)) ?? 0])), itemsSig);
            }, fail);
        } else if (strategy === 'amount' && namesUnique) {
            const typed = persons.map((p) => parseTyped(p.amountText));
            if (typed.every((a): a is number => a !== null && a > 0) && summarizePaymentAllocation(payable, typed).exact) {
                api.splitByAmount(orderId, persons.map((p, i) => ({ personName: normalizePayerName(p.name), amount: typed[i] as number }))).then((res) => {
                    const r = res as { valid?: boolean; error?: string };
                    if (r.valid === false) return fail(new Error(r.error || 'La división por monto no es válida.'));
                    ok(Object.fromEntries(persons.map((p, i) => [p.id, typed[i] as number])), amountSig);
                }, fail);
            } else {
                setShares({});
                setShareSig('');
            }
        } else {
            setShares({});
            setShareSig('');
        }
        return () => {
            seq.current++;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the signatures stand for the objects they summarise
    }, [strategy, locked, itemsSig, evenSig, amountSig, allAssigned, namesUnique, orderId, api]);

    const currentSig = strategy === 'items' ? itemsSig : strategy === 'evenly' ? evenSig : amountSig;
    const sharesFresh = shareSig === currentSig && persons.every((p) => (shares[p.id] ?? 0) > 0);
    const reconciles = sharesFresh && summarizePaymentAllocation(payable, persons.map((p) => shares[p.id] ?? 0)).exact;
    const paidTotal = persons.filter((p) => paid.includes(p.id)).reduce((n, p) => n + (shares[p.id] ?? 0), 0);

    const patch = (id: string, change: Partial<Person>) => setPersons((cur) => cur.map((p) => (p.id === id ? { ...p, ...change } : p)));
    const addPerson = () => {
        if (persons.length >= MAX_PEOPLE || locked) return;
        setPersons((cur) => [...cur, makePerson(counter)]);
        setCounter((n) => n + 1);
    };
    const removePerson = (id: string) => {
        if (persons.length <= 2 || locked) return;
        setPersons((cur) => cur.filter((p) => p.id !== id));
        setOwners((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v.map((o) => (o === id ? null : o))])));
    };
    const changeStrategy = (next: Strategy) => {
        if (locked) return;
        setStrategy(next);
        setOwners({});
        setSelectedLine(null);
        setShares({});
        setShareSig('');
        onError(null);
    };

    const assignTo = (personId: string) => {
        const line = lines.find((l) => l.id === selectedLine);
        if (!line || locked) return;
        const units = ownersOf(line);
        const at = units.indexOf(null);
        if (at < 0) return;
        setOwners((cur) => ({ ...cur, [line.id]: units.map((o, i) => (i === at ? personId : o)) }));
        if (units.filter((o) => o === null).length === 1) setSelectedLine(null);
    };
    const unassign = (line: ServerLine, personId: string) => {
        if (locked) return;
        const units = ownersOf(line);
        const at = units.lastIndexOf(personId);
        if (at < 0) return;
        setOwners((cur) => ({ ...cur, [line.id]: units.map((o, i) => (i === at ? null : o)) }));
    };

    const chargePerson = (p: Person) => {
        const method = methods.find((m) => m.id === p.methodId);
        const amount = shares[p.id] ?? 0;
        if (!method || busy || !reconciles || amount <= 0) return;
        const cash = isCashType(method.type);
        const received = p.received === '' ? amount : (parseTyped(p.received) ?? 0);
        const leg: Leg = { id: p.id, paymentMethodId: method.id, amount, payerName: normalizePayerName(p.name), ...(!cash && p.reference.trim() ? { reference: p.reference.trim() } : {}) };
        void ctx.charge([leg], {
            allIds: persons.map((x) => x.id),
            changeOf: { [p.id]: cash ? cashChange(received, amount) : 0 },
            methodOf: Object.fromEntries(persons.map((x) => [x.id, methods.find((m) => m.id === x.methodId)?.name ?? ''])),
            expected: payable,
            plan: { persons, counter, strategy, owners, shares, shareSig },
        });
    };

    const unassignedLines = lines.filter((l) => ownersOf(l).some((o) => o === null));

    return (
        <>
            <section className="pay-col pay-center" aria-label="Dividir cuenta">
                <div className="pay-seg" role="group" aria-label="Forma de dividir">
                    {STRATEGIES.map((s) => (
                        <button key={s.id} type="button" className="btn" aria-pressed={strategy === s.id} disabled={locked} onClick={() => changeStrategy(s.id)}>
                            {s.label}
                        </button>
                    ))}
                </div>
                {strategy === 'items' && (
                    <div className="pay-unassigned">
                        <h3 className="pay-h">Sin asignar</h3>
                        {unassignedLines.length === 0 && <p className="muted">Todo asignado.</p>}
                        <ul>
                            {unassignedLines.map((l) => {
                                const left = ownersOf(l).filter((o) => o === null).length;
                                const label = l.quantity > 1 ? `${l.name} · ${left} de ${l.quantity}` : l.name;
                                return (
                                    <li key={l.id}>
                                        <button type="button" className="btn pay-line" aria-label={label} aria-pressed={selectedLine === l.id} disabled={locked} onClick={() => setSelectedLine(l.id)}>
                                            <span>{label}</span>
                                            <span>{money((l.subtotal / l.quantity) * left)}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        <p className="muted">{selectedLine == null ? 'Toca un producto y luego a la persona.' : 'Ahora toca a la persona.'}</p>
                    </div>
                )}
                {strategy === 'evenly' && <p className="muted">{`La cuenta se divide en ${persons.length} partes iguales. Usa + Persona para cambiar el número.`}</p>}
                {strategy === 'amount' && <p className="muted">Escribe lo que paga cada persona; la suma debe ser exactamente el total.</p>}
            </section>

            <section className="pay-col pay-people" aria-label="Personas">
                {persons.map((p, index) => {
                    const done = paid.includes(p.id);
                    const method = methods.find((m) => m.id === p.methodId);
                    const cash = isCashType(method?.type);
                    const share = shares[p.id] ?? 0;
                    const received = p.received === '' ? share : (parseTyped(p.received) ?? 0);
                    const cashBlocked = cash && !shiftOk;
                    const cashShort = cash && moneyToCents(received) < moneyToCents(share);
                    const mine = lines.flatMap((l) => {
                        const n = ownersOf(l).filter((o) => o === p.id).length;
                        return n > 0 ? [{ line: l, n }] : [];
                    });
                    const canCharge = !done && !busy && reconciles && !!method && !cashBlocked && !cashShort && namesUnique;
                    return (
                        <article key={p.id} className="pay-person" aria-label={`Persona ${index + 1}`} data-paid={done}>
                            <div className="pay-person-head">
                                <input aria-label={`Nombre de la persona ${index + 1}`} value={p.name} maxLength={60} disabled={locked} onChange={(e) => patch(p.id, { name: e.target.value })} />
                                {!locked && persons.length > 2 && (
                                    <button type="button" className="btn icon-btn" aria-label={`Quitar a ${p.name}`} onClick={() => removePerson(p.id)}>
                                        ✕
                                    </button>
                                )}
                            </div>
                            {strategy === 'items' && (
                                <>
                                    <button type="button" className="btn" aria-label={`Asignar a ${p.name}`} disabled={locked || selectedLine == null} onClick={() => assignTo(p.id)}>
                                        Asignar aquí
                                    </button>
                                    <ul className="pay-mine">
                                        {mine.map(({ line, n }) => (
                                            <li key={line.id}>
                                                <span>{n > 1 ? `${line.name} ×${n}` : line.name}</span>
                                                {!locked && (
                                                    <button type="button" className="btn icon-btn" aria-label={`Quitar ${line.name} de ${p.name}`} onClick={() => unassign(line, p.id)}>
                                                        ✕
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                            {strategy === 'amount' && !locked && (
                                <input aria-label={`Monto de ${p.name}`} inputMode="decimal" placeholder="0.00" value={p.amountText} onChange={(e) => patch(p.id, { amountText: e.target.value.replace(/[^\d.]/g, '') })} />
                            )}
                            <div className="pay-person-total">
                                <span className="muted">A cobrar</span>
                                <strong>{sharesFresh ? money(share) : '—'}</strong>
                            </div>
                            {done ? (
                                <span className="pay-paid">Pagado</span>
                            ) : (
                                <>
                                    <select aria-label={`Método de ${p.name}`} disabled={ctx.pending.includes(p.id)} value={p.methodId ?? ''} onChange={(e) => patch(p.id, { methodId: Number(e.target.value) })}>
                                        {methods.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name}
                                            </option>
                                        ))}
                                    </select>
                                    {cashBlocked && (
                                        <p className="error" role="alert">
                                            {ctx.shiftIssue ? ctx.shiftIssue.text : 'Abre tu turno de caja para cobrar en efectivo.'}
                                        </p>
                                    )}
                                    {cashBlocked && ctx.shiftIssue?.onAction && (
                                        <button type="button" className="btn" disabled={busy} onClick={ctx.shiftIssue.onAction}>
                                            {ctx.shiftIssue.actionLabel}
                                        </button>
                                    )}
                                    {cashBlocked && !ctx.shiftIssue && ctx.onOpenShift && (
                                        <button type="button" className="btn" disabled={busy} onClick={ctx.onOpenShift}>
                                            Abrir turno
                                        </button>
                                    )}
                                    {cash && !cashBlocked && (
                                        <input aria-label={`Recibido de ${p.name}`} inputMode="decimal" placeholder="Recibido (exacto)" value={p.received} onChange={(e) => patch(p.id, { received: e.target.value.replace(/[^\d.]/g, '') })} />
                                    )}
                                    {cash && !cashBlocked && !cashShort && share > 0 && received > share && <span className="pay-change">{`Cambio ${money(cashChange(received, share))}`}</span>}
                                    {method && !cash && <input aria-label={`Referencia de ${p.name}`} placeholder="Referencia" maxLength={191} disabled={ctx.pending.includes(p.id)} value={p.reference} onChange={(e) => patch(p.id, { reference: e.target.value })} />}
                                    <button type="button" className="btn btn-primary" aria-label={`Cobrar a ${p.name}`} disabled={!canCharge} onClick={() => chargePerson(p)}>
                                        {sharesFresh ? `Cobrar ${money(share)}` : 'Cobrar'}
                                    </button>
                                </>
                            )}
                        </article>
                    );
                })}
                {!locked && persons.length < MAX_PEOPLE && (
                    <button type="button" className="btn" onClick={addPerson}>
                        + Persona
                    </button>
                )}
            </section>
            <footer className="pay-foot pay-foot-split">
                <span>{`Pagado ${money(paidTotal)}`}</span>
                <span className="muted">{`Pendiente ${money(Math.max(0, payable - paidTotal))}`}</span>
            </footer>
        </>
    );
}
