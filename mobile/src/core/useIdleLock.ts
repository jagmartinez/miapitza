import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const;

/** Calls onLock after `ms` without a pointerdown/keydown. Any input restarts the countdown. */
export function useIdleLock(onLock: () => void, ms = 120_000): void {
    const lockRef = useRef(onLock);
    lockRef.current = onLock;

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => lockRef.current(), ms);
        };
        arm();
        // Capture phase: still counts when a child stops propagation.
        for (const name of ACTIVITY_EVENTS) document.addEventListener(name, arm, true);
        return () => {
            clearTimeout(timer);
            for (const name of ACTIVITY_EVENTS) document.removeEventListener(name, arm, true);
        };
    }, [ms]);
}
