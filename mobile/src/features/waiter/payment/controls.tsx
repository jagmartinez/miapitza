import { IconBackspace, IconBuildingBank, IconCash, IconCreditCard, IconDots } from '../../../ui/Icon';
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
                <button key={k} type="button" className="key" disabled={disabled} aria-label={k === '<' ? 'Borrar' : k} onClick={() => onKey(k)}>
                    {k === '<' ? <IconBackspace size={22} stroke={1.5} aria-hidden /> : k}
                </button>
            ))}
        </div>
    );
}

/** Tabler icon per method type (cash, card, transfer, anything else). */
export function MethodIcon({ type }: { type: string }) {
    const common = { size: 20, stroke: 1.5, 'aria-hidden': true } as const;
    if (type === 'CASH') return <IconCash {...common} />;
    if (type === 'CARD') return <IconCreditCard {...common} />;
    if (type === 'BANK_TRANSFER') return <IconBuildingBank {...common} />;
    return <IconDots {...common} />;
}

/** 2x2 method tiles: borderless grey, icon + name; the chosen one is white-filled. */
export function MethodTiles({ methods, selected, onSelect, disabledIds = [], label = 'Método de pago' }: { methods: Method[]; selected: number | null; onSelect: (id: number) => void; disabledIds?: number[]; label?: string }) {
    return (
        <div className="pay-methods" role="group" aria-label={label}>
            {methods.map((m) => (
                <button key={m.id} type="button" className="btn-ghost pay-method" aria-pressed={selected === m.id} disabled={disabledIds.includes(m.id)} onClick={() => onSelect(m.id)}>
                    <MethodIcon type={m.type} />
                    <span>{m.name}</span>
                </button>
            ))}
        </div>
    );
}

export function QuickAmounts({ amounts, onPick, selectedIndex = null }: { amounts: number[]; onPick: (amount: number, index: number) => void; selectedIndex?: number | null }) {
    return (
        <div className="pay-quick" role="group" aria-label="Montos rápidos">
            {amounts.map((a, i) => (
                <button key={`${a}-${i}`} type="button" className="btn btn-outline" aria-pressed={selectedIndex === i} onClick={() => onPick(a, i)}>
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
