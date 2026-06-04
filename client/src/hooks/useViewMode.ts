import { useState, useCallback } from 'react';

export type ViewMode = 'cards' | 'table';

/**
 * Persists a catalog view preference (cards | table) per storage key.
 * Each catalog page passes a unique key so users keep an independent
 * preference per view.
 */
export function useViewMode(key: string, initial: ViewMode = 'cards') {
    const storageKey = `view_mode_${key}`;
    const [viewMode, setViewModeState] = useState<ViewMode>(() => {
        try {
            return (localStorage.getItem(storageKey) as ViewMode) || initial;
        } catch {
            return initial;
        }
    });

    const setViewMode = useCallback((mode: ViewMode) => {
        setViewModeState(mode);
        try {
            localStorage.setItem(storageKey, mode);
        } catch {
            /* ignore storage errors */
        }
    }, [storageKey]);

    return { viewMode, setViewMode };
}
