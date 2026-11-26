import { useCallback, useEffect, useRef } from 'react';
import { appEvents } from '../../core/events';

/**
 * Lets paused work (commits, Iniciar) resume once the kitchen session is usable again:
 * either the auth status goes back to 'online' or a new session arrives (`sessionKey` changes
 * to a new non-null value), which also covers a socket that never reaches CONNECTED.
 */
export function useSessionWake(sessionKey: string | null | undefined) {
    const wakers = useRef(new Set<() => void>());
    const last = useRef(sessionKey);
    useEffect(() => {
        if (sessionKey === last.current) return;
        last.current = sessionKey;
        if (sessionKey) for (const wake of [...wakers.current]) wake();
    }, [sessionKey]);

    /** Calls `resume` once, on the next wake-up. Returns a cancel function. */
    return useCallback((resume: () => void): (() => void) => {
        let done = false;
        const fire = () => {
            if (done) return;
            done = true;
            off();
            wakers.current.delete(fire);
            resume();
        };
        const off = appEvents.on('kitchen-auth-status', (status) => {
            if (status === 'online') fire();
        });
        wakers.current.add(fire);
        return () => {
            done = true;
            off();
            wakers.current.delete(fire);
        };
    }, []);
}
