import { money } from '../order/orderModel';
import type { Method } from './paymentFlow';

/** Appends a key to an amount being typed: digits, one dot, two decimals, "<" deletes. */
export function typeKey(text: string, key: string): string {
    if (key === '<') return text.slice(0, -1);
    if (key === '.') return text.includes('.') ? text : text === '' ? '0.' : `${text}.`;
    if (/\.\d{2}$/.test(text) || text.replace('.', '').length >= 9) return text;
    return text === '0' ? key : text + key;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'];

export function Keypad({ onKey, disabled = false }: { onKey: (key: string) => void; disabled?: boolean }) {
    return (
        <div className="pay-keys" role="group" aria-label="Teclado">
            {KEYS.map((k) => (
                <button key={k} type="button" className="btn" disabled={disabled} aria-label={k === '<' ? 'Borrar' : k} onClick={() => onKey(k)}>
                    {k === '<' ? '⌫' : k}
                </button>
            ))}
        </div>
    );
}

export function MethodIcon({ type }: { type: string }) {
    const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
    if (type === 'CASH')
        return (
            <svg {...common}>
                <rect x="3" y="6" width="18" height="12" rx="2" />
                <circle cx="12" cy="12" r="2.5" />
            </svg>
        );
    if (type === 'CARD')
        return (
            <svg {...common}>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 10h18" />
            </svg>
        );
    if (type === 'BANK_TRANSFER')
        return (
            <svg {...common}>
                <path d="M4 9h14l-3-3M20 15H6l3 3" />
            </svg>
        );
    return (
        <svg {...common}>
            <circle cx="6" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="18" cy="12" r="1.5" />
        </svg>
    );
}

/** 2×2 method tiles (icon + name). */
export function MethodTiles({ methods, selected, onSelect, disabledIds = [], label = 'Método de pago' }: { methods: Method[]; selected: number | null; onSelect: (id: number) => void; disabledIds?: number[]; label?: string }) {
    return (
        <div className="pay-methods" role="group" aria-label={label}>
            {methods.map((m) => (
                <button key={m.id} type="button" className="btn pay-method" aria-pressed={selected === m.id} disabled={disabledIds.includes(m.id)} onClick={() => onSelect(m.id)}>
                    <MethodIcon type={m.type} />
                    <span>{m.name}</span>
                </button>
            ))}
        </div>
    );
}

export function QuickAmounts({ amounts, onPick }: { amounts: number[]; onPick: (amount: number, index: number) => void }) {
    return (
        <div className="pay-quick" role="group" aria-label="Montos rápidos">
            {amounts.map((a, i) => (
                <button key={`${a}-${i}`} type="button" className="btn" onClick={() => onPick(a, i)}>
                    {i === 0 ? 'Exacto' : money(a)}
                </button>
            ))}
        </div>
    );
}

export function ChargeButton({ amount, disabled, onClick }: { amount: number; disabled: boolean; onClick: () => void }) {
    return (
        <footer className="pay-foot">
            <button type="button" className="btn btn-primary pay-charge" disabled={disabled} onClick={onClick}>
                {`Cobrar ${money(amount)}`}
            </button>
        </footer>
    );
}

/** "12.50" typed by the cashier -> 12.5; empty or malformed -> null. */
export function parseTyped(text: string): number | null {
    if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
    return Number(text);
}
