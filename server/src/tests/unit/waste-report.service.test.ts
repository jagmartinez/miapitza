import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { WasteReportService } from '../../services/waste-report.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Waste report physical quantities', () => {
    it('never adds quantities expressed in different base units', async () => {
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            {
                id: 1, quantity: 2, totalCost: 10, unitCost: 5, reason: 'WASTE: Merma por cancelación de orden #44', reference: 'WASTE-ORD-44', createdAt: new Date(),
                product: { name: 'Harina', unit: 'kg', baseUnit: { abbreviation: 'kg' }, cost: 5, currentAverageCost: 5 },
                warehouse: { name: 'Central' }, user: { name: 'Ana' }
            },
            {
                id: 2, quantity: 3, totalCost: 6, unitCost: 2, reason: 'WASTE: Merma de modificador por cancelación de orden #44', reference: 'WASTE-ORD-44', createdAt: new Date(),
                product: { name: 'Leche', unit: 'l', baseUnit: { abbreviation: 'l' }, cost: 2, currentAverageCost: 2 },
                warehouse: { name: 'Central' }, user: { name: 'Ana' }
            }
        ] as never);

        const report = await WasteReportService.getWasteReport(1, {});

        expect(report.summary.quantities).toEqual([{ unit: 'kg', quantity: 2 }, { unit: 'l', quantity: 3 }]);
        expect(report.byReason).toEqual([
            expect.objectContaining({ reason: 'Merma por cancelación de orden #44', unit: 'kg', quantity: 2, cost: 10 }),
            expect.objectContaining({ reason: 'Merma de modificador por cancelación de orden #44', unit: 'l', quantity: 3, cost: 6 })
        ]);
        expect(report.summary.totalCost).toBe(16);
        expect(report.details).toEqual(expect.arrayContaining([
            expect.objectContaining({ reference: 'WASTE-ORD-44', unit: 'kg', quantity: 2, cost: 10 }),
            expect.objectContaining({ reference: 'WASTE-ORD-44', unit: 'l', quantity: 3, cost: 6 })
        ]));
    });
});
