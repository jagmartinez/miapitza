import { useCallback, useEffect, useRef } from 'react';
import { exitKiosk } from '../../core/kiosk';

const HOLD_MS = 5_000;

/**
 * Hidden exit path for the kiosk: holding the element for 5 s asks to leave it.
 * Spread the returned handlers on the "Cocina" title.
 */
export function useKioskExit() {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancel = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    }, []);

    const start = useCallback(() => {
        cancel();
        timer.current = setTimeout(() => {
            timer.current = null;
            if (window.confirm('¿Salir del modo kiosco?')) void exitKiosk();
        }, HOLD_MS);
    }, [cancel]);

    useEffect(() => cancel, [cancel]);

    return {
        onPointerDown: start,
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
        onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    };
}
