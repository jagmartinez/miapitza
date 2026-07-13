import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { SplitBillService } from '../../services/split-bill.service';

describe('SplitBillService totals alignment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('splitEvenly uses order.total as final total', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 99,
            total: 150 as unknown as never,
            discount: 10 as unknown as never,
            tipAmount: 20 as unknown as never,
            items: []
        } as never);

        const result = await SplitBillService.splitEvenly(99, 1, 3);

        expect(result.finalTotal).toBe(150);
        expect(result.splits.reduce((sum, s) => sum + s.amount, 0)).toBe(150);
    });

    it('splitByAmount validates against order.total', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 100,
            total: 120 as unknown as never,
            discount: 15 as unknown as never,
            tipAmount: 10 as unknown as never
        } as never);

        const result = await SplitBillService.splitByAmount(100, 1, [
            { personName: 'A', amount: 60 },
            { personName: 'B', amount: 60 }
        ]);

        expect(result.valid).toBe(true);
        expect(result.finalTotal).toBe(120);
    });

    it('rejects duplicate or unassigned item allocations', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 20, discount: 0, tax: 0, tipAmount: 0,
            items: [
                { id: 10, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'A' }, modifiers: [] },
                { id: 11, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'B' }, modifiers: [] }
            ]
        } as never);

        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', itemIds: [10] },
            { personName: 'B', itemIds: [10] }
        ])).rejects.toThrow(/mas de una persona/i);

        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', itemIds: [10] }
        ])).rejects.toThrow(/exactamente una vez/i);
    });

    it('rejects non-finite custom split amounts', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 1, total: 20 } as never);
        await expect(SplitBillService.splitByAmount(1, 1, [
            { personName: 'A', amount: Number.POSITIVE_INFINITY }
        ])).rejects.toThrow(/finito/i);
    });
});
