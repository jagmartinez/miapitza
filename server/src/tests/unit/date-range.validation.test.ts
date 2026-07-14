import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { validateQueryDates } from '../../middlewares/validate-query-dates';
import { parseQueryDateFrom, parseQueryDateTo } from '../../utils/date-range';

describe('financial report date validation', () => {
    it('rejects invalid date values before they reach Prisma', () => {
        expect(() => parseQueryDateFrom('not-a-date')).toThrow(/Fecha de consulta inválida/);
        expect(() => parseQueryDateTo('2026-99-40', 'America/Managua')).toThrow(/Fecha de consulta inválida/);
    });

    it('returns 400 from the shared query middleware', () => {
        const req = {
            query: { dateFrom: 'not-a-date' },
            user: { timezone: 'America/Managua' }
        } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validateQueryDates('dateFrom')(req, { status, json } as unknown as Response, next);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects an inverted report interval', () => {
        const middleware = validateQueryDates('startDate', 'endDate');
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn();

        middleware(
            { query: { startDate: '2026-07-20', endDate: '2026-07-01' }, user: { timezone: 'America/Managua' } } as never,
            { status, json } as never,
            next
        );

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/fecha inicial/i) }));
        expect(next).not.toHaveBeenCalled();
    });
});
