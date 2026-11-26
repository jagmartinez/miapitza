import { describe, expect, it } from 'vitest';
import {
    formatPromotionDateKey,
    promotionDateInput,
    promotionDatePayload,
    toZonedDateInput,
} from './promotionDates';

describe('toZonedDateInput', () => {
    it('shows a Managua end-of-day validTo as the same local calendar day', () => {
        // 2026-11-18 23:59:59.999 in America/Managua (UTC-6)
        expect(toZonedDateInput('2026-11-19T05:59:59.999Z', 'America/Managua')).toBe('2026-11-18');
        expect(toZonedDateInput('2026-11-18T06:00:00.000Z', 'America/Managua')).toBe('2026-11-18');
    });

    it('returns empty string for invalid input', () => {
        expect(toZonedDateInput('not-a-date', 'America/Managua')).toBe('');
    });
});

describe('promotionDateInput', () => {
    it('prefers the company-zone date key over the session time zone', () => {
        // Company in Managua saved "valid until 2026-11-18"; a user whose
        // session zone is Madrid would otherwise see (and re-save) the 19th.
        expect(promotionDateInput('2026-11-18', '2026-11-19T05:59:59.999Z', 'Europe/Madrid')).toBe('2026-11-18');
        expect(toZonedDateInput('2026-11-19T05:59:59.999Z', 'Europe/Madrid')).toBe('2026-11-19');
    });

    it('falls back to the instant when the API did not send a key', () => {
        expect(promotionDateInput(undefined, '2026-11-19T05:59:59.999Z', 'America/Managua')).toBe('2026-11-18');
        expect(promotionDateInput(null, null, 'America/Managua')).toBe('');
    });
});

describe('formatPromotionDateKey', () => {
    it('formats the calendar key without shifting the day', () => {
        expect(formatPromotionDateKey('2026-11-18')).toMatch(/18/);
        expect(formatPromotionDateKey('2026-11-18')).toMatch(/2026/);
    });
});

describe('promotionDatePayload', () => {
    it('on create sends the start only when set and an explicit end', () => {
        expect(promotionDatePayload({ validFrom: '', validTo: '' }, null)).toEqual({ validTo: null });
        expect(promotionDatePayload({ validFrom: '2026-11-01', validTo: '2026-11-30' }, null))
            .toEqual({ validFrom: '2026-11-01', validTo: '2026-11-30' });
    });

    it('on edit omits unchanged bounds so an intra-day start is not reset to 00:00', () => {
        const initial = { validFrom: '2026-11-18', validTo: '2026-11-30' };
        expect(promotionDatePayload({ ...initial }, initial)).toEqual({});
    });

    it('on edit sends only the bounds the user changed', () => {
        const initial = { validFrom: '2026-11-18', validTo: '2026-11-30' };
        expect(promotionDatePayload({ validFrom: '2026-11-18', validTo: '2026-12-15' }, initial)).toEqual({ validTo: '2026-12-15' });
        expect(promotionDatePayload({ validFrom: '2026-11-20', validTo: '2026-11-30' }, initial)).toEqual({ validFrom: '2026-11-20' });
        expect(promotionDatePayload({ validFrom: '2026-11-18', validTo: '' }, initial)).toEqual({ validTo: null });
    });
});
