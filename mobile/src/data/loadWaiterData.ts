import type { Services } from '../core/services';
import type { WaiterData } from './waiterData';

let instance: Promise<WaiterData> | null = null;

/**
 * Waiter mode only: Dexie and the data layer load on first use, so the PIN screen and the
 * kitchen bundle never include them. Import THIS file (not ./waiterData) from app code.
 */
/** Device revoked: every owner's queue, drafts, caches and plans go (the tablet is no longer ours). The next use starts empty. */
export async function wipeWaiterData(services: Pick<Services, 'http' | 'sessions'>): Promise<void> {
    const data = await loadWaiterData(services);
    instance = null;
    await data.db.delete();
}

export function loadWaiterData(services: Pick<Services, 'http' | 'sessions'>): Promise<WaiterData> {
    instance ??= import('./waiterData').then((m) => m.createWaiterData(services));
    return instance;
}
