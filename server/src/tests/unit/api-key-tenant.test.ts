import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { apiKeyAuth } from '../../middlewares/apiKey';
import { SettingService } from '../../services/setting.service';

function responseMock() {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    return { status, json } as unknown as Response;
}

describe('API key tenant context', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('rejects a valid key when its company is inactive', async () => {
        jest.spyOn(prisma.apiKey, 'findUnique').mockResolvedValue({
            id: 1,
            active: true,
            expiresAt: null,
            scopes: ['read:reports'],
            companyId: 9,
            company: { active: false }
        } as never);
        const timezone = jest.spyOn(SettingService, 'getTimezone');
        const req = { headers: { 'x-api-key': 'test-key' } } as unknown as Request;
        const res = responseMock();
        const next = jest.fn() as unknown as NextFunction;

        await apiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(timezone).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('populates the authoritative tenant timezone for an active API key', async () => {
        jest.spyOn(prisma.apiKey, 'findUnique').mockResolvedValue({
            id: 2,
            active: true,
            expiresAt: null,
            scopes: ['read:reports'],
            companyId: 4,
            company: { active: true }
        } as never);
        jest.spyOn(prisma.apiKey, 'update').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        const req = { headers: { 'x-api-key': 'test-key' } } as unknown as Request;
        const res = responseMock();
        const next = jest.fn() as unknown as NextFunction;

        await apiKeyAuth(req, res, next);

        expect(req.user).toEqual(expect.objectContaining({
            companyId: 4,
            timezone: 'America/Managua',
            permissions: [],
        }));
        expect(next).toHaveBeenCalledTimes(1);
    });
});
