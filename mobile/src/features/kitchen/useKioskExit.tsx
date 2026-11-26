import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { exitKiosk } from '../../core/kiosk';

const HOLD_MS = 5_000;
const CONFIRM_MS = 10_000;

/**
 * Hidden exit path for the kiosk: holding the element for 5 s opens an in-app confirm sheet
 * (never window.confirm, which would freeze the WebView) that closes itself after 10 s.
 * Spread `handlers` on the "Cocina" title and render `sheet` anywhere.
 */
export function useKioskExit(): {
    handlers: {
        onPointerDown: () => void;
        onPointerUp: () => void;
        onPointerLeave: () => void;
        onPointerCancel: () => void;
        onContextMenu: (e: { preventDefault(): void }) => void;
    };
    sheet: ReactNode;
} {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [open, setOpen] = useState(false);

    const cancel = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    }, []);

    const close = useCallback(() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = null;
        setOpen(false);
    }, []);

    const start = useCallback(() => {
        cancel();
        timer.current = setTimeout(() => {
            timer.current = null;
            setOpen(true);
            if (closeTimer.current) clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(close, CONFIRM_MS);
        }, HOLD_MS);
    }, [cancel, close]);

    useEffect(
        () => () => {
            cancel();
            if (closeTimer.current) clearTimeout(closeTimer.current);
        },
        [cancel],
    );

    const sheet = open ? (
        <div className="kds-sheet-backdrop" onClick={close}>
            <div className="kds-sheet kitchen-exit" role="dialog" aria-modal="true" aria-label="Salir del modo kiosco" onClick={(e) => e.stopPropagation()}>
                <p className="kitchen-exit-text">¿Salir del modo kiosco?</p>
                <div className="kitchen-exit-actions">
                    <button
                        type="button"
                        className="kitchen-btn"
                        onClick={() => {
                            close();
                            void exitKiosk();
                        }}
                    >
                        Salir
                    </button>
                    <button type="button" className="kitchen-btn" onClick={close}>
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return {
        handlers: {
            onPointerDown: start,
            onPointerUp: cancel,
            onPointerLeave: cancel,
            onPointerCancel: cancel,
            onContextMenu: (e) => e.preventDefault(),
        },
        sheet,
    };
}
