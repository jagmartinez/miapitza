import { Capacitor } from '@capacitor/core';
import type { AppMode } from './mode';

/** Waiter and kitchen tablets are landscape; the personal phone is portrait. */
export function orientationFor(mode: AppMode): 'landscape' | 'portrait' | null {
    if (mode === 'waiter' || mode === 'kitchen') return 'landscape';
    if (mode === 'account') return 'portrait';
    return null;
}

/** Never throws: on web (and in tests) there is nothing to lock. */
export async function applyOrientation(mode: AppMode): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const { ScreenOrientation } = await import('@capacitor/screen-orientation');
        const wanted = orientationFor(mode);
        if (wanted) await ScreenOrientation.lock({ orientation: wanted });
        else await ScreenOrientation.unlock();
    } catch {
        // Plugin missing or lock refused: the app still works in the current orientation.
    }
}
