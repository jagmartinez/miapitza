import { describe, expect, it } from '@jest/globals';

import {
    getZonedDayBounds,
    parseZonedDateEnd,
    parseZonedDateStart,
    zonedDateKey,
    zonedHour
} from '../../utils/timezone';

describe('tenant timezone boundaries', () => {
    it('maps a Managua business day to the correct UTC interval', () => {
        expect(parseZonedDateStart('2026-07-12', 'America/Managua').toISOString())
            .toBe('2026-07-12T06:00:00.000Z');
        expect(parseZonedDateEnd('2026-07-12', 'America/Managua').toISOString())
            .toBe('2026-07-13T05:59:59.999Z');
    });

    it('does not depend on the host timezone when deriving today', () => {
        const bounds = getZonedDayBounds('America/Managua', new Date('2026-07-13T02:00:00Z'));
        expect(bounds.start.toISOString()).toBe('2026-07-12T06:00:00.000Z');
        expect(bounds.endExclusive.toISOString()).toBe('2026-07-13T06:00:00.000Z');
    });

    it('groups UTC instants by the tenant local date and hour', () => {
        const instant = new Date('2026-07-13T02:30:00Z');
        expect(zonedDateKey(instant, 'America/Managua')).toBe('2026-07-12');
        expect(zonedHour(instant, 'America/Managua')).toBe(20);
    });

    it('honors DST-sized days in zones that use daylight saving time', () => {
        const bounds = getZonedDayBounds('America/New_York', new Date('2026-03-08T12:00:00Z'));
        expect(bounds.endExclusive.getTime() - bounds.start.getTime()).toBe(23 * 60 * 60 * 1000);
    });
});
