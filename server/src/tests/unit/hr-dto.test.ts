import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { allowHrBodyFields } from '../../middlewares/hr-dto';

describe('HR DTO allowlist', () => {
    it('rejects ownership and privileged fields not declared by the route', () => {
        const req = { body: { name: 'Operaciones', companyId: 999 } } as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn().mockReturnThis();
        const res = { status, json } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        allowHrBodyFields(['name'])(req, res, next);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'El cuerpo contiene campos no permitidos' }));
        expect(next).not.toHaveBeenCalled();
    });
});
