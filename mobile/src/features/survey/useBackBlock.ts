import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** While `active`, the Android hardware Back button does nothing. No-op on web. */
export function useBackBlock(active: boolean): void {
    useEffect(() => {
        if (!active || !Capacitor.isNativePlatform()) return undefined;
        let removed = false;
        let handle: { remove: () => Promise<void> } | null = null;
        void App.addListener('backButton', () => undefined).then((h) => {
            if (removed) void h.remove();
            else handle = h;
        });
        return () => {
            removed = true;
            if (handle) void handle.remove();
        };
    }, [active]);
}
