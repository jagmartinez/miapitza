import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';

describe('BankReconciliationService.getReconciliationStatus', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('classifies totals by payment method from payments', async () => {
        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([
            { amount: 100, paymentMethod: { name: 'Efectivo' } },
            { amount: 40, paymentMethod: { name: 'Tarjeta' } },
            { amount: 30, paymentMethod: { name: 'Transferencia' } }
        ] as never);

        jest.spyOn(prisma.cashShift, 'findMany').mockResolvedValue([
            {
                id: 1,
                startAmount: 50,
                endAmount: 150,
                cashRegister: { name: 'Caja 1' },
                user: { name: 'Cajero 1' },
                movements: [
                    { type: 'IN', amount: 100 },
                    { type: 'OUT', amount: 0 }
                ]
            }
        ] as never);

        const start = new Date('2026-01-01T00:00:00.000Z');
        const end = new Date('2026-01-31T23:59:59.999Z');
        const result = await BankReconciliationService.getReconciliationStatus(1, start, end);

        expect(result.totals.totalSales).toBe(170);
        expect(result.totals.byMethod.cash).toBe(100);
        expect(result.totals.byMethod.card).toBe(40);
        expect(result.totals.byMethod.transfer).toBe(30);
    });
});

