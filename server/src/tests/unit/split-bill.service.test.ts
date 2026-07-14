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

    it('splits only the authoritative remaining balance after partial payments', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 99,
            total: 150 as unknown as never,
            discount: 0 as unknown as never,
            tipAmount: 0 as unknown as never,
            payments: [{ amount: 40 as unknown as never }],
            items: []
        } as never);

        const result = await SplitBillService.splitEvenly(99, 1, 2);

        expect(result.originalTotal).toBe(150);
        expect(result.totalPaid).toBe(40);
        expect(result.remainingBalance).toBe(110);
        expect(result.splits.map((split) => split.amount)).toEqual([55, 55]);
    });

    it('distributes indivisible cents without creating zero-value diners', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 99, total: 0.05, payments: [], items: []
        } as never);
        const result = await SplitBillService.splitEvenly(99, 1, 3);
        expect(result.splits.map((split) => split.amount)).toEqual([0.02, 0.02, 0.01]);

        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 100, total: 0.02, payments: [], items: []
        } as never);
        await expect(SplitBillService.splitEvenly(100, 1, 3)).rejects.toThrow(/centavos pendientes/i);
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

    it('validates custom splits against the remaining balance, not the original total', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 100,
            total: 120 as unknown as never,
            payments: [{ amount: 20 as unknown as never }]
        } as never);

        const result = await SplitBillService.splitByAmount(100, 1, [
            { personName: 'A', amount: 50 },
            { personName: 'B', amount: 50 }
        ]);

        expect(result.valid).toBe(true);
        expect(result.finalTotal).toBe(100);
        expect(result.totalPaid).toBe(20);
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

    it('keeps a named diner paid when rebuilding an item split after a partial charge', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 20, discount: 0, tax: 0, tipAmount: 0,
            payments: [{ amount: 10, payerName: 'Ana' }],
            items: [
                { id: 10, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'A' }, modifiers: [] },
                { id: 11, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'B' }, modifiers: [] }
            ]
        } as never);

        const result = await SplitBillService.splitByItems(1, 1, [
            { personName: 'Ana', itemIds: [10] },
            { personName: 'Beto', itemIds: [11] }
        ]);

        expect(result.remainingBalance).toBe(10);
        expect(result.splits.map((split) => ({ name: split.personName, total: split.total })))
            .toEqual([{ name: 'Ana', total: 0 }, { name: 'Beto', total: 10 }]);
    });

    it('splits one order line by integer quantities and reconciles every cent', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 10.03, discount: 0.01, tax: 0.02, tipAmount: 0.02, payments: [],
            items: [
                { id: 10, subtotal: 10, quantity: 3, price: 3, menuItem: { name: 'Compartido' }, modifiers: [] }
            ]
        } as never);

        const result = await SplitBillService.splitByItems(1, 7, [
            { personName: 'Ana', items: [{ orderItemId: 10, quantity: 1 }] },
            { personName: 'Beto', items: [{ orderItemId: 10, quantity: 2 }] }
        ]);

        expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 1, companyId: 7 }
        }));
        expect(result.splits.map((split) => ({
            quantity: split.items[0].quantity,
            amount: split.items[0].amount,
            subtotal: split.subtotal,
            discount: split.discount,
            tax: split.tax,
            tip: split.tip,
            total: split.total
        }))).toEqual([
            { quantity: 1, amount: 3.33, subtotal: 3.33, discount: 0, tax: 0.01, tip: 0.01, total: 3.35 },
            { quantity: 2, amount: 6.67, subtotal: 6.67, discount: 0.01, tax: 0.01, tip: 0.01, total: 6.68 }
        ]);
        expect(result.splits.flatMap((split) => split.items).reduce((sum, item) => sum + item.amount, 0)).toBe(10);
        expect(result.splitTotal).toBe(10.03);
    });

    it('rejects fractional, non-positive, excessive and incomplete quantities', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 12, discount: 0, tax: 0, tipAmount: 0, payments: [],
            items: [
                { id: 10, subtotal: 12, quantity: 3, price: 4, menuItem: { name: 'A' }, modifiers: [] }
            ]
        } as never);

        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', items: [{ orderItemId: 10, quantity: 1.5 }] }
        ])).rejects.toThrow(/enteros positivos/i);
        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', items: [{ orderItemId: 10, quantity: 0 }] }
        ])).rejects.toThrow(/enteros positivos/i);
        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', items: [{ orderItemId: 10, quantity: 4 }] }
        ])).rejects.toThrow(/exceder/i);
        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'A', items: [{ orderItemId: 10, quantity: 2 }] }
        ])).rejects.toThrow(/exactamente una vez/i);
    });

    it('keeps the legacy itemIds contract as a full-line assignment', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 12, discount: 0, tax: 0, tipAmount: 0, payments: [],
            items: [
                { id: 10, subtotal: 12, quantity: 3, price: 4, menuItem: { name: 'A' }, modifiers: [] }
            ]
        } as never);

        const result = await SplitBillService.splitByItems(1, 1, [
            { personName: 'A', itemIds: [10] }
        ]);

        expect(result.splits[0].items[0]).toEqual(expect.objectContaining({
            orderItemId: 10,
            quantity: 3,
            amount: 12,
            subtotal: 12
        }));
        expect(result.splitTotal).toBe(12);
    });

    it('rejects empty or duplicate payer identities case-insensitively', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 20, discount: 0, tax: 0, tipAmount: 0, payments: [],
            items: [
                { id: 10, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'A' }, modifiers: [] },
                { id: 11, subtotal: 10, quantity: 1, price: 10, menuItem: { name: 'B' }, modifiers: [] }
            ]
        } as never);

        await expect(SplitBillService.splitByItems(1, 1, [
            { personName: 'Ana', itemIds: [10] },
            { personName: ' ana ', itemIds: [11] }
        ])).rejects.toThrow(/únicos/i);

        await expect(SplitBillService.splitByAmount(1, 1, [
            { personName: ' ', amount: 20 }
        ])).rejects.toThrow(/debe tener un nombre/i);
    });

    it('rejects non-finite custom split amounts', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 1, total: 20 } as never);
        await expect(SplitBillService.splitByAmount(1, 1, [
            { personName: 'A', amount: Number.POSITIVE_INFINITY }
        ])).rejects.toThrow(/finito/i);
    });

    it('requires exact cents and exact reconciliation for custom splits', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 1, total: 10, payments: [] } as never);
        await expect(SplitBillService.splitByAmount(1, 1, [
            { personName: 'A', amount: 9.99 }
        ])).resolves.toEqual(expect.objectContaining({ valid: false, splitTotal: 9.99 }));

        await expect(SplitBillService.splitByAmount(1, 1, [
            { personName: 'A', amount: 10.001 }
        ])).rejects.toThrow(/dos decimales/i);
    });
});
