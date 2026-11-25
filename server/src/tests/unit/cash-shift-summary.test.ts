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
            endAmount: 130,
            cashRegister: { id: 1, name: 'Caja' },
            user: { id: 3, name: 'Ana' },
            movements: [
                { type: 'IN', amount: 100, reference: 'PAY-10' },
                { type: 'IN', amount: 40, reference: 'CAT-PAY-20' },
                { type: 'OUT', amount: 25, reference: 'CN-REF-NC-1-PAY-10' },
                { type: 'OUT', amount: 10, reference: 'REV-PAY-11' },
                { type: 'OUT', amount: 15, reference: 'REV-CAT-PAY-21' },
                { type: 'OUT', amount: 10, reference: 'EXP-1' }
            ]
        } as never);

        const result = await CashShiftService.getShiftSummary(7, 2);

        expect(result.summary).toMatchObject({
            grossSalesCash: 140,
            cashRefunds: 50,
            totalSalesCash: 90,
            totalIn: 140,
            totalOut: 60,
            expectedBalance: 130,
            difference: 0
        });
    });
});
