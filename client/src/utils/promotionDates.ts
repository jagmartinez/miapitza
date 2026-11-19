/**
 * Calendar day (YYYY-MM-DD) of an instant as seen in the given time zone.
 * Promotion windows are stored as instants (validFrom = local 00:00,
 * validTo = local 23:59:59.999); `toISOString().slice(0, 10)` would show the
 * UTC day, i.e. the day after for a validTo in America/Managua.
 */
export function toZonedDateInput(value: string | Date, timeZone?: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar day to display/edit for a promotion bound. The API returns
 * `validFromDate` / `validToDate` computed in the COMPANY time zone (the zone
 * the server uses to parse saved dates); prefer them, since the session time
 * zone may be the branch's and would shift the window one day per save. Falls
 * back to deriving the day from the instant for older API responses.
 */
export function promotionDateInput(
    dateKey: string | null | undefined,
    instant: string | null | undefined,
    fallbackTimeZone?: string,
): string {
    if (dateKey && DATE_KEY.test(dateKey)) return dateKey;
    return instant ? toZonedDateInput(instant, fallbackTimeZone) : '';
}

/** Formats a YYYY-MM-DD calendar key for display without any time-zone shift. */
export function formatPromotionDateKey(dateKey: string, locale = 'es-MX'): string {
    if (!DATE_KEY.test(dateKey)) return dateKey;
    return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(locale, {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
}

export interface PromotionDateFields {
    validFrom: string;
    validTo: string;
}

/**
 * Date fields to send on save. On create, an empty start means "now" and an
 * empty end means "no end". On edit, a bound is only sent when the user
 * changed it: re-sending an unchanged start as a bare date would move a
 * promotion that began at e.g. 14:37 back to local 00:00.
 */
export function promotionDatePayload(
    form: PromotionDateFields,
    initial: PromotionDateFields | null,
): { validFrom?: string; validTo?: string | null } {
    if (!initial) {
        return {
            ...(form.validFrom ? { validFrom: form.validFrom } : {}),
            validTo: form.validTo || null,
        };
    }
    const payload: { validFrom?: string; validTo?: string | null } = {};
    // The start bound cannot be cleared on the server; an emptied field keeps it.
    if (form.validFrom && form.validFrom !== initial.validFrom) payload.validFrom = form.validFrom;
    if (form.validTo !== initial.validTo) payload.validTo = form.validTo || null;
    return payload;
}
