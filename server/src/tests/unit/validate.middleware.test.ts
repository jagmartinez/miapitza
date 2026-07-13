import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { validate } from '../../middlewares/validate';

describe('shared request validation', () => {
    it.each([Infinity, -Infinity, 'Infinity', '-Infinity'])(
        'rejects non-finite numeric input %p',
        (amount) => {
            const req = { body: { amount } } as unknown as Request;
            const status = jest.fn().mockReturnThis();
            const json = jest.fn();
            const next = jest.fn() as unknown as NextFunction;

            validate({ body: { amount: { type: 'number', required: true } } })(
                req,
                { status, json } as unknown as Response,
                next
            );

            expect(status).toHaveBeenCalledWith(400);
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
            expect(next).not.toHaveBeenCalled();
        }
    );

    it('accepts a finite numeric string', () => {
        const req = { body: { amount: '12.50' } } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validate({ body: { amount: { type: 'number', required: true } } })(
            req,
            { status, json } as unknown as Response,
            next
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });
});
