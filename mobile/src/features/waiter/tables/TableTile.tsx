import { useRef, type CSSProperties } from 'react';
import type { TableState } from './tableState';

const LONG_PRESS_MS = 500;
const STATE_LABEL: Record<TableState, string> = { free: 'libre', occupied: 'ocupada', ready: 'pedido listo', due: 'por cobrar' };

export interface TableTileProps {
    id: number;
    label: string;
    state: TableState;
    /** Up to three short lines; each is clipped with an ellipsis. */
    lines: string[];
    style: CSSProperties;
    grouped?: boolean;
    /** Non-valid destination while choosing a target table. */
    dimmed?: boolean;
    onTap: () => void;
    onLongPress?: () => void;
}

export function TableTile({ id, label, state, lines, style, grouped, dimmed, onTap, onLongPress }: TableTileProps) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);

    const clear = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };
    const startPress = () => {
        fired.current = false;
        clear();
        if (!onLongPress) return;
        timer.current = setTimeout(() => {
            timer.current = null;
            fired.current = true;
            onLongPress();
        }, LONG_PRESS_MS);
    };

    return (
        <button
            type="button"
            className={`tile${grouped ? ' tile-grouped' : ''}${dimmed ? ' tile-dim' : ''}`}
            data-testid={`tile-${id}`}
            data-state={state}
            aria-label={`Mesa ${label}, ${STATE_LABEL[state]}`}
            aria-disabled={dimmed || undefined}
            style={style}
            onPointerDown={startPress}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            // Android WebView raises contextmenu on a long press: treat it as ours and never show the system menu.
            onContextMenu={(e) => {
                e.preventDefault();
                if (!fired.current && onLongPress) {
                    clear();
                    fired.current = true;
                    onLongPress();
                }
            }}
            onClick={() => {
                if (fired.current) {
                    fired.current = false;
                    return;
                }
                onTap();
            }}
        >
            {lines.slice(0, 3).map((text, i) => (
                <span key={i} className={`tile-line${i === 0 ? ` tile-num${numSize(text)}` : ''}`}>
                    {text}
                </span>
            ))}
        </button>
    );
}

/** Long table names ("FIL1MES1") shrink instead of being cut to "FIL1M…": the waiter must tell tables apart. */
export function numSize(name: string): string {
    if (name.length > 8) return ' tile-num-xlong';
    if (name.length > 5) return ' tile-num-long';
    return '';
}
