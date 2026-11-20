import type { Services } from '../core/services';
import type { WaiterData } from './waiterData';

let instance: Promise<WaiterData> | null = null;

/**
 * Waiter mode only: Dexie and the data layer load on first use, so the PIN screen and the
 * kitchen bundle never include them. Import THIS file (not ./waiterData) from app code.
 */
export function loadWaiterData(services: Pick<Services, 'http' | 'sessions'>): Promise<WaiterData> {
    instance ??= import('./waiterData').then((m) => m.createWaiterData(services));
    return instance;
}
