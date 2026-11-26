import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import { SURVEY_URL } from '../../data/queueLabels';
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

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;
const codeOf = (e: unknown): string => String((e as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code ?? '');

/**
 * May the survey have been lost in transit (network, timeout, 5xx, 429)? A SURVEY_* answer (order not paid, invalid...) is definitive:
 * no replay fixes it. Any other 409 (IDEMPOTENCY_IN_PROGRESS) stays ambiguous.
 */
const mayRetry = (error: unknown): boolean => {
    const code = codeOf(error);
    if (code.startsWith('SURVEY_')) return false;
    // The same key with other answers (a second survey of the same order): the first answer stands, replaying cannot change that.
    if (code === 'IDEMPOTENCY_MISMATCH') return false;
    // A 404 without our code is a missing route (deploy/URL problem), not an answer about this survey: keep it queued.
    if (statusOf(error) === 404) return true;
    return isAmbiguousMutationFailure(error);
};

/** The first attempt must fail (and be queued) while the session still exists: shorter than the screen's settle bound. */
export const FIRST_ATTEMPT_TIMEOUT_MS = 5_000;

const LABEL = 'Encuesta del cliente';
const queue = { operationType: 'GENERIC_MUTATION' as const, meta: { label: LABEL } };

export function createSurveyApi(api: { mutate: (spec: Parameters<WaiterApi['mutate']>[0]) => Promise<unknown> }) {
    return {
        /**
         * Online it goes out now; offline `mutate` queues it. A network/5xx failure (it may or may not have arrived) is
         * queued with the same key so it replays once. A definitive 4xx is rethrown: it is never queued.
         */
        async submit(input: SurveyInput, idempotencyKey: string): Promise<void> {
            const attempt = async (data: SurveyInput, key: string): Promise<void> => {
                const spec = { method: 'POST' as const, url: SURVEY_URL, data, key };
                try {
                    await api.mutate({ ...spec, queue, config: { timeout: FIRST_ATTEMPT_TIMEOUT_MS } });
                } catch (error) {
                    // The same request is already in flight on the server: it will be stored.
                    if (statusOf(error) === 409 && codeOf(error) === 'IDEMPOTENCY_IN_PROGRESS') return;
                    if (!mayRetry(error)) throw error;
                    await api.mutate({ ...spec, queue: { ...queue, forceQueue: true } });
                }
            };
            try {
                await attempt(input, idempotencyKey);
            } catch (error) {
                // One bad optional field must not cost the NPS and the ratings: retry once without the free text.
                if (statusOf(error) === 400 && codeOf(error) === 'SURVEY_INVALID' && (input.comment !== null || input.contactPhone !== null)) {
                    await attempt({ ...input, comment: null, contactPhone: null }, `${idempotencyKey}-lite`);
                    return;
                }
                throw error;
            }
        },
    };
}
