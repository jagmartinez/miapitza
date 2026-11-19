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

    describe('days whose local midnight does not exist (DST starts at 00:00)', () => {
        const cases = [
            // zone, local day, first instant of the day (01:00 local), previous day end, day end
            ['America/Santiago', '2026-09-06', '2026-09-06T04:00:00.000Z', '2026-09-05', '2026-09-07T02:59:59.999Z'],
            ['America/Havana', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-07', '2026-03-09T03:59:59.999Z'],
            ['Asia/Beirut', '2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-28', '2026-03-29T20:59:59.999Z'],
        ] as const;

        it.each(cases)('%s %s starts at the first valid instant of the local day', (zone, day, start, previousDay, end) => {
            expect(parseZonedDateStart(day, zone).toISOString()).toBe(start);
            expect(zonedDateKey(parseZonedDateStart(day, zone), zone)).toBe(day);
            expect(parseZonedDateEnd(day, zone).toISOString()).toBe(end);
            // The previous day ends exactly 1 ms before the gap day starts.
            expect(parseZonedDateEnd(previousDay, zone).getTime()).toBe(new Date(start).getTime() - 1);
            // Instant-based helpers use the same fallback instead of throwing.
            const bounds = getZonedDayBounds(zone, new Date(new Date(start).getTime() + 6 * 60 * 60 * 1000));
            expect(bounds.start.toISOString()).toBe(start);
            expect(bounds.endExclusive.getTime() - bounds.start.getTime()).toBe(23 * 60 * 60 * 1000);
        });
    });
});
