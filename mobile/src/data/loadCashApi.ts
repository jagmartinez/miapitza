import type { Services } from '../core/services';
import type { CashApi } from './cashApi';

let instance: Promise<CashApi> | null = null;

/**
 * Caja only: the cash data layer loads on first use, so the PIN screen, the kitchen and the waiter bundles never include it
 * (same pattern as loadWaiterData). Import THIS file, never ./cashApi, from app code.
 */
export function loadCashApi(services: Pick<Services, 'http' | 'sessions'>): Promise<CashApi> {
    instance ??= Promise.all([import('./cashApi'), import('./useOnline')]).then(([m, o]) =>
        m.createCashApi({ http: services.http, sessions: services.sessions, isOnline: o.isOnline }),
    );
    return instance;
}
