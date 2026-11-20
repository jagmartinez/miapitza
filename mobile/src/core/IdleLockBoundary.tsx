import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIdleLock } from './useIdleLock';

export const IDLE_LOCK_MS = 120_000;
/** While a cash count has entries the cashier's hands are on the money, not on the screen. */
export const COUNTING_IDLE_LOCK_MS = 600_000;

const ExtendContext = createContext<(on: boolean) => void>(() => undefined);

/** A screen with work in progress that must survive a longer pause calls this with `true` while it has it (and `false` when done). */
export function useExtendedIdleLock(active: boolean): void {
    const set = useContext(ExtendContext);
    useEffect(() => {
        set(active);
        return () => set(false);
    }, [set, active]);
}

/** Locks after 2 minutes without input, or 10 while a descendant asked for the extension (it still locks, and unmounting clears its work). */
export function IdleLockBoundary({ onLock, children }: { onLock: () => void; children: ReactNode }) {
    const [extended, setExtended] = useState(false);
    useIdleLock(onLock, extended ? COUNTING_IDLE_LOCK_MS : IDLE_LOCK_MS);
    const value = useMemo(() => setExtended, []);
    return <ExtendContext.Provider value={value}>{children}</ExtendContext.Provider>;
}
