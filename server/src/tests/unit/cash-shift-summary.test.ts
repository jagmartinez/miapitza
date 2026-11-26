import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CashShiftService } from '../../services/cash-shift.service';

describe('CashShiftService.getShiftSummary fiscal cash counterflows', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reconciles POS and Catering cash sales with reversals, credit notes and non-sale expenses', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            id: 7,
            startAmount: 50,
            endAmount: 145.35,
            cashRegister: { id: 1, name: 'Caja', branchId: 5 },
            user: { id: 3, name: 'Ana' },
            movements: [
                { type: 'IN', amount: 100, reference: 'PAY-10' },
                { type: 'IN', amount: 40, reference: 'CAT-PAY-20' },
                { type: 'IN', amount: 15.25, reference: null },
                { type: 'IN', amount: 0.10, reference: 'LEGACY-IN-1' },
                { type: 'OUT', amount: 25, reference: 'CN-REF-NC-1-PAY-10' },
                { type: 'OUT', amount: 10, reference: 'REV-PAY-11' },
                { type: 'OUT', amount: 15, reference: 'REV-CAT-PAY-21' },
                { type: 'OUT', amount: 10, reference: 'EXP-1' }
            ]
        } as never);

        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
        const result = await CashShiftService.getShiftSummary(7, 2);

        expect(result.summary).toMatchObject({
            grossSalesCash: 140,
            cashRefunds: 50,
            totalSalesCash: 90,
            otherIncome: 15.35,
            otherOutflows: 10,
            totalIn: 155.35,
            totalOut: 60,
            expectedBalance: 145.35,
            difference: 0
        });
    });

    it('summary includes sales by method and payment count', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            id: 8,
            userId: 3,
            startDate: new Date('2026-11-20T14:00:00Z'),
            endDate: null,
            startAmount: 50,
            endAmount: null,
            cashRegister: { id: 1, name: 'Caja', branchId: 5 },
            user: { id: 3, name: 'Ana' },
            movements: [{ type: 'IN', amount: 100, reference: 'PAY-10' }, { type: 'OUT', amount: 20, reference: 'REV-PAY-11' }]
        } as never);
        const findMany = jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([
            { orderId: 1, methodType: 'CASH', amount: 120 },
            { orderId: 2, methodType: 'CARD', amount: 30.25 },
            { orderId: 2, methodType: 'CARD', amount: 30.25 }, // split bill: second leg of order 2
            { orderId: 3, methodType: 'BANK_TRANSFER', amount: 20 },
            { orderId: 4, methodType: 'OTHER', amount: 5 }
        ] as never);

        const result = await CashShiftService.getShiftSummary(8, 2);

        expect(result.summary.salesByMethod).toEqual({ cash: 80, card: 60.5, transfer: 25, paymentCount: 4 });
        const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({
            registeredById: 3,
            status: 'ACTIVE',
            createdAt: { gte: new Date('2026-11-20T14:00:00Z'), lte: expect.any(Date) },
            order: { companyId: 2, branchId: 5 }
        });
    });

    it('a closed shift window is exclusive at the end', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            id: 9, userId: 3, startDate: new Date('2026-11-20T14:00:00Z'), endDate: new Date('2026-11-20T22:00:00Z'), startAmount: 0, endAmount: 0,
            cashRegister: { id: 1, name: 'Caja', branchId: 5 }, user: { id: 3, name: 'Ana' }, movements: []
        } as never);
        const findMany = jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
        await CashShiftService.getShiftSummary(9, 2);
        const createdAt = (findMany.mock.calls[0][0] as { where: { createdAt: Record<string, unknown> } }).where.createdAt;
        expect(createdAt).toEqual({ gte: new Date('2026-11-20T14:00:00Z'), lt: new Date('2026-11-20T22:00:00Z') });
    });
});
