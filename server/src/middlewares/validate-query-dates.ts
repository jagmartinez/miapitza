import type { NextFunction, Request, Response } from 'express';
import { InvalidQueryDateError, parseQueryDateFrom, parseQueryDateTo } from '../utils/date-range';

const FROM_KEYS = new Set(['dateFrom', 'startDate']);

export function validateQueryDates(...keys: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsed = new Map<string, Date>();
            for (const key of keys) {
                const raw = req.query[key];
                if (raw === undefined || raw === '') continue;
                if (typeof raw !== 'string') throw new InvalidQueryDateError(String(raw));
                parsed.set(key, FROM_KEYS.has(key)
                    ? parseQueryDateFrom(raw, req.user?.timezone)
                    : parseQueryDateTo(raw, req.user?.timezone));
            }
            for (const [fromKey, toKey] of [['dateFrom', 'dateTo'], ['startDate', 'endDate']]) {
                const from = parsed.get(fromKey);
                const to = parsed.get(toKey);
                if (from && to && from > to) {
                    return res.status(400).json({
                        success: false,
                        message: 'La fecha inicial no puede ser posterior a la fecha final'
                    });
                }
            }
            next();
        } catch (error) {
            if (error instanceof InvalidQueryDateError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            next(error);
        }
    };
}
