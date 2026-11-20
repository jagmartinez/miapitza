import { useMemo, useState } from 'react';
import { moneyToCents } from '@web/utils/payment';
import { money } from '../order/orderModel';
import { ChargeButton, Keypad, MethodTiles, parseTyped, QuickAmounts, typeKey } from './controls';
import { cashChange, isCashType, quickAmounts, type ModeCtx } from './paymentFlow';

export const SINGLE_LEG_ID = 'single';

/** The first method the cashier can use right now (cash needs an open shift). */
export function firstUsable(methods: ModeCtx['methods'], shiftOk: boolean) {
    return (methods.find((m) => !isCashType(m.type) || shiftOk) ?? methods[0])?.id ?? null;
}

export function SinglePayment({ ctx }: { ctx: ModeCtx }) {
    const { methods, shiftOk, payable, busy } = ctx;
    const [methodId, setMethodId] = useState<number | null>(() => firstUsable(methods, shiftOk));
    const [typed, setTyped] = useState(''); // '' = the exact amount
    const [reference, setReference] = useState('');
    const method = methods.find((m) => m.id === methodId) ?? null;
    const cash = isCashType(method?.type);
    const blocked = cash && !shiftOk;
    const received = typed === '' ? payable : (parseTyped(typed) ?? 0);
    const change = cash ? cashChange(received, payable) : 0;
    const enough = moneyToCents(received) >= moneyToCents(payable);
    const quick = useMemo(() => quickAmounts(payable), [payable]);
    const canCharge = !!method && !blocked && !busy && payable > 0 && (!cash || enough);

    const charge = () => {
        if (!method || !canCharge) return;
        void ctx.charge(
            [{ id: SINGLE_LEG_ID, paymentMethodId: method.id, amount: payable, ...(!cash && reference.trim() ? { reference: reference.trim() } : {}) }],
            { allIds: [SINGLE_LEG_ID], changeOf: { [SINGLE_LEG_ID]: change }, methodOf: { [SINGLE_LEG_ID]: method.name }, expected: payable },
        );
    };

    return (
        <>
            <section className="pay-col pay-center" aria-label="Método y montos">
                <MethodTiles methods={methods} selected={methodId} onSelect={(id) => { setMethodId(id); setTyped(''); }} />
                {cash && !blocked && <QuickAmounts amounts={quick} onPick={(a, i) => setTyped(i === 0 ? '' : String(a))} />}
            </section>
            <section className="pay-col pay-right" aria-label="Recibido">
                {blocked ? (
                    <div className="pay-blocked" role="alert">
                        <strong>Abre tu turno de caja</strong>
                        <span className="muted">Necesitas un turno de caja abierto hoy para cobrar en efectivo. Elige otro método o abre tu turno.</span>
                    </div>
                ) : cash ? (
                    <>
                        <div className="pay-readout">
                            <div>
                                <span className="muted">Recibido</span>
                                <strong>{money(received)}</strong>
                            </div>
                            <div className="pay-change">
                                <span className="muted">Cambio</span>
                                <strong>{money(change)}</strong>
                            </div>
                        </div>
                        <Keypad onKey={(k) => setTyped((t) => typeKey(t, k))} />
                    </>
                ) : (
                    <label className="field">
                        {`Referencia${method ? ` de ${method.name.toLowerCase()}` : ''}`}
                        <input value={reference} maxLength={191} autoComplete="off" onChange={(e) => setReference(e.target.value)} />
                    </label>
                )}
            </section>
            <ChargeButton amount={payable} disabled={!canCharge} onClick={charge} />
        </>
    );
}
