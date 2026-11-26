import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { UserController } from '../../controllers/user.controller';
import {
    parsePreferencesPatch,
    resolvePreferences,
    UserPreferencesService,
} from '../../services/user-preferences.service';

describe('user preferences', () => {
    const json = jest.fn();
    const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
    beforeEach(() => { jest.clearAllMocks(); });

    it('validates every field and rejects what is not allowed', () => {
        expect(parsePreferencesPatch({ rowsPerPage: 50, density: 'compact' })).toEqual({ rowsPerPage: 50, density: 'compact' });
        expect(() => parsePreferencesPatch({ rowsPerPage: 33 })).toThrow('Filas por página inválidas');
        expect(() => parsePreferencesPatch({ density: 'huge' })).toThrow('Densidad inválida');
        expect(() => parsePreferencesPatch({ homePage: 'https://evil.test' })).toThrow('Página de inicio inválida');
        expect(() => parsePreferencesPatch({ homePage: '//evil.test' })).toThrow('Página de inicio inválida');
        expect(() => parsePreferencesPatch({ defaultBranchId: 0 })).toThrow('Sucursal inválida');
        expect(() => parsePreferencesPatch({ notifications: { unknown: { app: true } } })).toThrow('Notificaciones inválidas');
        expect(() => parsePreferencesPatch({ notifications: { payroll: { sms: true } } })).toThrow('Notificaciones inválidas');
    });

    it('falls back to defaults when the stored value is corrupt', () => {
        expect(resolvePreferences(null).rowsPerPage).toBe(25);
        expect(resolvePreferences({ rowsPerPage: 'x' }).rowsPerPage).toBe(25);
        expect(resolvePreferences({ rowsPerPage: 100 }).rowsPerPage).toBe(100);
    });

    it('merges a patch into the stored preferences of the authenticated user only', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ preferences: { rowsPerPage: 10, notifications: { payroll: { app: true } } } } as never);
        const update = jest.spyOn(prisma.user, 'update').mockResolvedValue({ id: 17 } as never);

        const result = await UserPreferencesService.update(17, { rowsPerPage: 50, notifications: { payroll: { email: true } } });

        expect(result.rowsPerPage).toBe(50);
        expect(result.density).toBe('comfortable');
        expect(result.notifications).toEqual({ payroll: { app: true, email: true } });
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 17 } }));
    });

    it('PUT /users/me/preferences saves with the token identity, never a body id', async () => {
        const update = jest.spyOn(UserPreferencesService, 'update').mockResolvedValue({ rowsPerPage: 50 } as never);
        const req = { user: { userId: 17, companyId: 4 }, body: { rowsPerPage: 50, id: 99, userId: 99 } } as unknown as Request;
        await UserController.updateMyPreferences(req, { json } as unknown as Response, next);
        expect(update).toHaveBeenCalledWith(17, expect.objectContaining({ rowsPerPage: 50 }));
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { rowsPerPage: 50 } }));
    });

    it('answers 400 for an invalid preference and does not write', async () => {
        const update = jest.spyOn(prisma.user, 'update');
        const req = { user: { userId: 17, companyId: 4 }, body: { rowsPerPage: 7 } } as unknown as Request;
        await UserController.updateMyPreferences(req, { json } as unknown as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(update).not.toHaveBeenCalled();
    });
});
