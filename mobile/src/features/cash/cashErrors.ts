import { getApiErrorMessage } from '@web/utils/apiError';
import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import { CashError, SessionChangedError } from '../../data/cashApi';

/** Spanish text for any failure of a cash call: the server's own message for a cash code, the shared API helper otherwise (never raw axios English). */
export function cashErrorText(cause: unknown, fallback = 'No se pudo completar.'): string {
    if (cause instanceof CashError) return cause.message || fallback;
    const text = getApiErrorMessage(cause);
    return text || fallback;
}

/** "Reintentar" only when the outcome is unknown (network, timeout, 5xx): a definitive answer would fail the same way. */
export function isRetryable(cause: unknown): boolean {
    if (cause instanceof CashError || cause instanceof SessionChangedError) return false;
    return isAmbiguousMutationFailure(cause);
}
