import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { ReservationController } from '../../controllers/reservation.controller';
import { ReservationService } from '../../services/reservation.service';
import { BranchScopeError } from '../../utils/branch-scope';

describe('ReservationController branch isolation', () => {
    it('rejects a same-company reservation belonging to another branch', async () => {
        jest.spyOn(ReservationService, 'getById').mockResolvedValue({ id: 5, branchId: 22 } as never);
        const req = {
            params: { id: '5' },
            user: { userId: 9, companyId: 3, branchId: 11, role: 'HOST', roles: ['HOST'] },
        } as unknown as Request;
        const res = { json: jest.fn() } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        await ReservationController.getById(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
        expect(res.json).not.toHaveBeenCalled();
    });
});
