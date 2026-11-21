import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import type { WaiterApi } from '../../data/waiterApi';

export interface SurveyInput {
    orderId: number;
    /** 0-10, required. */
    nps: number;
    /** Each 1-5, or null when the customer skipped it. */
    waiterRating: number | null;
    foodRating: number | null;
    waitRating: number | null;
    ambienceRating: number | null;
    comment: string | null;
    contactPhone: string | null;
}

/** One survey per order on the server: the same key on every attempt makes a repeat harmless. */
export const surveyKey = (orderId: number): string => `survey-order-${orderId}`;

/**
 * May the survey have been lost in transit (network, timeout, 5xx, 429)? A 409 is NOT ambiguous here, unlike other
 * mutations: SURVEY_ORDER_NOT_PAID is a definitive 409 that no replay would fix.
 */
const mayRetry = (error: unknown): boolean => (error as { response?: { status?: number } } | null)?.response?.status !== 409 && isAmbiguousMutationFailure(error);

const LABEL = 'Encuesta del cliente';
const queue = { operationType: 'GENERIC_MUTATION' as const, meta: { label: LABEL } };

export function createSurveyApi(api: { mutate: (spec: Parameters<WaiterApi['mutate']>[0]) => Promise<unknown> }) {
    return {
        /**
         * Online it goes out now; offline `mutate` queues it. A network/5xx failure (it may or may not have arrived) is
         * queued with the same key so it replays once. A definitive 4xx is rethrown: it is never queued.
         */
        async submit(input: SurveyInput, idempotencyKey: string): Promise<void> {
            const spec = { method: 'POST' as const, url: '/surveys', data: input, key: idempotencyKey };
            try {
                await api.mutate({ ...spec, queue });
            } catch (error) {
                if (!mayRetry(error)) throw error;
                await api.mutate({ ...spec, queue: { ...queue, forceQueue: true } });
            }
        },
    };
}
