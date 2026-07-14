import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { validate } from '../../middlewares/validate';
import { splitByItems } from '../../middlewares/validate-schemas';

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

    it.each([
        [[{ personName: 'Ana', itemIds: [10] }]],
        [[{ personName: 'Ana', items: [{ orderItemId: 10, quantity: 2 }] }]],
    ])('accepts legacy and quantity-aware split item payloads', (itemAssignments) => {
        const req = { params: { orderId: '1' }, body: { itemAssignments } } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const next = jest.fn() as unknown as NextFunction;

        validate(splitByItems)(req, { status, json: jest.fn() } as unknown as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5])('rejects invalid split item quantity %p', (quantity) => {
        const req = {
            params: { orderId: '1' },
            body: {
                itemAssignments: [{
                    personName: 'Ana',
                    items: [{ orderItemId: 10, quantity }]
                }]
            }
        } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validate(splitByItems)(req, { status, json } as unknown as Response, next);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        expect(next).not.toHaveBeenCalled();
    });
});
