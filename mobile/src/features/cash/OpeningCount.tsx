import { useState } from 'react';
import { money } from '../waiter/order/orderModel';
import { DENOMINATIONS, countedTotals, emptyBreakdown, type Breakdown } from './cashMath';
import { Keypad } from '../waiter/payment/controls';

type Group = 'nioBills' | 'nioCoins';
const label = (n: number) => String(n).replace(/\.0+$/, '');

/** "Contar billetes" of the opening float: NIO bills and coins; tap a denomination, type its count. */
export function OpeningCount({ onUse, onCancel }: { onUse: (total: number) => void; onCancel: () => void }) {
    const [counts, setCounts] = useState<Breakdown>(emptyBreakdown);
    const [sel, setSel] = useState<{ group: Group; denom: number } | null>(null);
    const total = countedTotals(counts, 0).totalC / 100;

    const key = (k: string) => {
        if (!sel || k === '.') return;
        setCounts((cur) => {
            const prev = String(cur[sel.group][String(sel.denom)] ?? 0);
            const next = k === '<' ? prev.slice(0, -1) : prev === '0' ? k : prev + k;
            const n = Math.min(Number(next || 0), 9999);
            return { ...cur, [sel.group]: { ...cur[sel.group], [String(sel.denom)]: n } };
        });
    };

    const row = (group: Group, denom: number) => {
        const n = counts[group][String(denom)] ?? 0;
        const kind = group === 'nioBills' ? 'Billete' : 'Moneda';
        return (
            <button key={`${group}-${denom}`} type="button" className="btn cash-denom" aria-pressed={sel?.group === group && sel.denom === denom} aria-label={`${kind} C$ ${label(denom)}`} onClick={() => setSel({ group, denom })}>
                <span className="cash-num">{`C$ ${label(denom)}`}</span>
                <strong className="cash-num">{`× ${n}`}</strong>
            </button>
        );
    };

    return (
        <div className="cash-count" role="group" aria-label="Contar billetes">
            <div className="cash-denoms">
                <div className="cash-denom-grid">{DENOMINATIONS.nioBills.map((d) => row('nioBills', d))}</div>
                <div className="cash-denom-grid">{DENOMINATIONS.nioCoins.map((d) => row('nioCoins', d))}</div>
            </div>
            <div className="cash-count-side">
                <Keypad onKey={key} disabled={!sel} />
                <button type="button" className="btn btn-primary" disabled={total <= 0} onClick={() => onUse(total)}>
                    {`Usar ${money(total)}`}
                </button>
                <button type="button" className="btn" onClick={onCancel}>
                    Cancelar
                </button>
            </div>
        </div>
    );
}
