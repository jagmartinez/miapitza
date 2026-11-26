import type { AxiosInstance } from 'axios';
import type { KitchenBatch, KitchenConfig } from './kitchenTypes';

export type KitchenActionErrorKind = 'network' | 'already-done' | 'rejected' | 'auth';

export class KitchenActionError extends Error {
    constructor(
        readonly kind: KitchenActionErrorKind,
        message: string,
        readonly code?: string,
    ) {
        super(message);
        this.name = 'KitchenActionError';
    }
}

type Action = 'start' | 'ready' | 'release';
type BatchRef = Pick<KitchenBatch, 'id' | 'kitchenBatchId'>;

function toActionError(cause: unknown, action: Action): KitchenActionError {
    if (cause instanceof KitchenActionError) return cause;
    const res = (cause as { response?: { status?: number; data?: { code?: string; message?: string } } } | null)?.response;
    const status = res?.status;
    const code = res?.data?.code;
    const message = res?.data?.message || (status ? 'La cocina rechazó la acción.' : 'Sin conexión con el servidor.');
    if (typeof status !== 'number') return new KitchenActionError('network', message);
    if (status === 401) return new KitchenActionError('auth', message, code);
    if (status >= 500 || status === 408 || status === 429 || code === 'IDEMPOTENCY_IN_PROGRESS') return new KitchenActionError('network', message, code);
    if (code === 'KITCHEN_BATCH_RELEASED' && (action === 'ready' || action === 'release')) {
        return new KitchenActionError('already-done', message, code);
    }
    return new KitchenActionError('rejected', message, code);
}

export function createKitchenApi(http: AxiosInstance) {
    async function act(action: Action, b: BatchRef, key: string): Promise<void> {
        try {
            await http.post(
                `/orders/${b.id}/kitchen/${action}`,
                { kitchenBatchId: b.kitchenBatchId },
                { headers: { 'X-Idempotency-Key': key } },
            );
        } catch (cause) {
            throw toActionError(cause, action);
        }
    }
    return {
        async config(): Promise<KitchenConfig> {
            const res = await http.get('/orders/kitchen/config');
            const d = res.data?.data ?? {};
            return { warningMinutes: d.warningMinutes, urgentMinutes: d.urgentMinutes };
        },
        async queue(): Promise<KitchenBatch[]> {
            const res = await http.get('/orders/kitchen/queue');
            return res.data?.data ?? [];
        },
        async recent(limit = 10): Promise<KitchenBatch[]> {
            const res = await http.get('/orders/kitchen/recent', { params: { limit } });
            return res.data?.data ?? [];
        },
        start: (b: BatchRef, key: string) => act('start', b, key),
        ready: (b: BatchRef, key: string) => act('ready', b, key),
        release: (b: BatchRef, key: string) => act('release', b, key),
    };
}

export type KitchenApi = ReturnType<typeof createKitchenApi>;
