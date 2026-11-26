import { useEffect, useRef } from 'react';
import { appEvents } from '../../core/events';

/** Runs `onRestored` after the same user logged in again over the kept tree (reads that failed with 401 must reload). */
export function useSessionRestored(onRestored: () => void): void {
    const ref = useRef(onRestored);
    ref.current = onRestored;
    useEffect(() => appEvents.on('account-session-restored', () => ref.current()), []);
}
