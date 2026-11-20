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
            cashRegister: { id: 1, name: 'Caja' },
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

        jest.spyOn(prisma.payment, 'groupBy').mockResolvedValue([] as never);
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
            cashRegister: { id: 1, name: 'Caja' },
            user: { id: 3, name: 'Ana' },
            movements: [{ type: 'IN', amount: 100, reference: 'PAY-10' }, { type: 'OUT', amount: 20, reference: 'REV-PAY-11' }]
        } as never);
        const groupBy = jest.spyOn(prisma.payment, 'groupBy').mockResolvedValue([
            { methodType: 'CASH', _sum: { amount: 120 }, _count: { _all: 2 } },
            { methodType: 'CARD', _sum: { amount: 60.5 }, _count: { _all: 3 } },
            { methodType: 'BANK_TRANSFER', _sum: { amount: 20 }, _count: { _all: 1 } },
            { methodType: 'OTHER', _sum: { amount: 5 }, _count: { _all: 1 } }
        ] as never);

        const result = await CashShiftService.getShiftSummary(8, 2);

        expect(result.summary.salesByMethod).toEqual({ cash: 80, card: 60.5, transfer: 25, paymentCount: 7 });
        const where = (groupBy.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({ registeredById: 3, status: 'ACTIVE', order: { companyId: 2 } });
    });
});
