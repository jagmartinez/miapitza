import type { Key } from './countMath';

const row = (keys: Key[]): Key[] => keys;
const ROWS: Key[][] = [row(['7', '8', '9']), row(['4', '5', '6']), row(['1', '2', '3'])];

export interface DecimalKeypadProps {
    onKey: (key: Key) => void;
    onSave: () => void;
    /** Nothing on screen is the target: every key is off. */
    disabled?: boolean;
    saveDisabled?: boolean;
}

/** 4 columns x 4 rows: digits on three columns, ⌫ and C on the fourth, and "Guardar y siguiente" as the tall key under them. */
export function DecimalKeypad({ onKey, onSave, disabled, saveDisabled }: DecimalKeypadProps) {
    const digit = (k: Key) => (
        <button key={k} type="button" className="cnt-key" disabled={disabled} onClick={() => onKey(k)}>
            {k}
        </button>
    );
    return (
        <div className="cnt-keypad" role="group" aria-label="Teclado">
            {ROWS[0].map(digit)}
            <button type="button" className="cnt-key cnt-key-aux" disabled={disabled} aria-label="Borrar" onClick={() => onKey('back')}>
                ⌫
            </button>
            {ROWS[1].map(digit)}
            <button type="button" className="cnt-key cnt-key-aux" disabled={disabled} aria-label="Limpiar" onClick={() => onKey('clear')}>
                C
            </button>
            {ROWS[2].map(digit)}
            <button type="button" className="cnt-key cnt-key-save" disabled={disabled || saveDisabled} onClick={onSave}>
                Guardar y siguiente
            </button>
            <button type="button" className="cnt-key cnt-key-zero" disabled={disabled} onClick={() => onKey('0')}>
                0
            </button>
            <button type="button" className="cnt-key" disabled={disabled} aria-label="Punto decimal" onClick={() => onKey('.')}>
                .
            </button>
        </div>
    );
}
