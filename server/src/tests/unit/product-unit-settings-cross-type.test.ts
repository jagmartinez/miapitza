import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { UnitConversionController } from '../../controllers/unit-conversion.controller';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

const units = {
    paquete: { id: 1, companyId: 1, abbreviation: 'paquete', measurementType: 'PACKAGE', systemFactor: 1, active: true },
    g: { id: 2, companyId: 1, abbreviation: 'g', measurementType: 'MASS', systemFactor: 1, active: true },
    unidad: { id: 3, companyId: 1, abbreviation: 'unidad', measurementType: 'UNIT', systemFactor: 1, active: true },
    kg: { id: 4, companyId: 1, abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000, active: true },
    und: { id: 5, companyId: 1, abbreviation: 'und', measurementType: 'UNIT', systemFactor: 1, active: true }
};

async function callSetProductUnits(baseUnitId: number, allowedUnits: Array<{ unitId: number; conversionFactor: number }>) {
    const catalog = Object.values(units);
    jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({ id: 9 } as never);
    jest.spyOn(prisma.unitOfMeasure, 'findFirst').mockResolvedValue(catalog.find((u) => u.id === baseUnitId) as never);
    jest.spyOn(prisma.unitOfMeasure, 'findMany').mockResolvedValue(catalog as never);
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValue(undefined as never);
    jest.spyOn(UnitConversionService, 'getAllowedUnits').mockResolvedValue([] as never);

    const req = {
        user: { companyId: 1 },
        params: { productId: '9' },
        body: { baseUnitId, allowedUnits }
    } as unknown as Request;
    const json = jest.fn();
    const res = { json } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    await UnitConversionController.setProductUnits(req, res, next);
    return { next: next as unknown as ReturnType<typeof jest.fn>, json, transaction };
}

describe('setProductUnits accepts cross-type alternates with an explicit factor (D5)', () => {
    it('accepts a gram alternate for a package base', async () => {
        const { next, transaction } = await callSetProductUnits(1, [
            { unitId: 1, conversionFactor: 1 },
            { unitId: 2, conversionFactor: 0.002 }
        ]);
        expect(next).not.toHaveBeenCalled();
        expect(transaction).toHaveBeenCalled();
    });

    it('accepts a kg alternate for a UNIT base', async () => {
        const { next, transaction } = await callSetProductUnits(3, [{ unitId: 4, conversionFactor: 8 }]);
        expect(next).not.toHaveBeenCalled();
        expect(transaction).toHaveBeenCalled();
    });

    it('still rejects a non-positive factor', async () => {
        const { next, transaction } = await callSetProductUnits(3, [{ unitId: 4, conversionFactor: 0 }]);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/mayor a 0/) }));
        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects the base unit with a factor other than 1', async () => {
        const { next } = await callSetProductUnits(3, [{ unitId: 3, conversionFactor: 2 }]);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/factor de conversión 1/) }));
    });

    it('rejects an alternate that is an alias of the base unit', async () => {
        const { next, transaction } = await callSetProductUnits(3, [{ unitId: 5, conversionFactor: 12 }]);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/misma unidad base/) }));
        expect(transaction).not.toHaveBeenCalled();
    });
});
