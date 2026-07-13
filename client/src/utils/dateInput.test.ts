import { describe, expect, it } from 'vitest';
import { formatLocalDateInput } from './dateInput';

describe('formatLocalDateInput', () => {
    it('uses local calendar fields rather than the UTC ISO day', () => {
        const localLateEvening = new Date(2026, 6, 12, 23, 30, 0);
        expect(formatLocalDateInput(localLateEvening)).toBe('2026-07-12');
    });
});
