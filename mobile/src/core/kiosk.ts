import { Capacitor, registerPlugin } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

interface KioskPlugin {
    start(): Promise<void>;
    stop(): Promise<void>;
    isActive(): Promise<{ active: boolean }>;
}

const Kiosk = registerPlugin<KioskPlugin>('Kiosk');

async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
    try {
        await run();
    } catch (err) {
        console.warn(`[kiosk] ${label} failed`, err);
    }
}

/** Keep the screen on and pin the app. Web no-op; never throws to the UI. */
export async function enterKiosk(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await attempt('keepAwake', () => KeepAwake.keepAwake());
    await attempt('start', () => Kiosk.start());
}

/** Undo enterKiosk. Web no-op; never throws to the UI. */
export async function exitKiosk(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await attempt('allowSleep', () => KeepAwake.allowSleep());
    await attempt('stop', () => Kiosk.stop());
}
