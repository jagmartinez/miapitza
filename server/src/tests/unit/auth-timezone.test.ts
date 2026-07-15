import { describe, expect, it } from '@jest/globals';
import { resolveRequestTimezone } from '../../middlewares/auth';

describe('authentication request timezone', () => {
    it('uses the active branch timezone before the company default', () => {
        expect(resolveRequestTimezone('America/New_York', 'America/Managua'))
            .toBe('America/New_York');
    });

    it('falls back through valid company and system timezones', () => {
        expect(resolveRequestTimezone('invalid/timezone', 'America/Costa_Rica'))
            .toBe('America/Costa_Rica');
        expect(resolveRequestTimezone('invalid/timezone', 'also/invalid'))
            .toBe('America/Managua');
    });
});
