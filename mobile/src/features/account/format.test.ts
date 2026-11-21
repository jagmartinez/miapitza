import { dateOnly, instantText, shiftText, timeText } from './format';

describe('format', () => {
    it('dateOnly reads the date part of a UTC-midnight ISO without shifting the day', () => {
        expect(dateOnly('2026-11-15T00:00:00.000Z')).toBe('15/11/2026');
        expect(dateOnly('2026-11-15')).toBe('15/11/2026');
        expect(dateOnly(null)).toBe('');
        expect(dateOnly('x')).toBe('');
    });

    it('instantText reads an instant in the given zone', () => {
        expect(instantText('2026-11-19T04:00:00.000Z', 'America/Managua')).toBe('18/11/2026 22:00');
        expect(timeText('2026-11-19T04:00:00.000Z', 'America/Managua')).toBe('22:00');
    });

    it('shiftText uses the snapshot zone and appends the branch', () => {
        expect(shiftText({ id: 1, startAt: '2026-11-25T15:00:00.000Z', endAt: '2026-11-25T23:00:00.000Z', timezoneSnapshot: 'America/Managua', branch: { id: 1, name: 'Matriz' } })).toBe(
            '25/11/2026 09:00-17:00 · Matriz',
        );
        expect(shiftText(null)).toBe('');
    });
});
