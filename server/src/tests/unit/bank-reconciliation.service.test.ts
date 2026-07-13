import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { SettingService } from '../../services/setting.service';

describe('BankReconciliationService.getReconciliationStatus', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('classifies totals by payment method from payments', async () => {
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
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

        expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'ACTIVE' })
        }));
        expect(result.totals.totalSales).toBe(170);
        expect(result.totals.byMethod.cash).toBe(100);
        expect(result.totals.byMethod.card).toBe(40);
        expect(result.totals.byMethod.transfer).toBe(30);
    });
});

describe('BankReconciliationService deposit lifecycle', () => {
    beforeEach(() => { jest.restoreAllMocks(); });

    it('allows a shift to be linked to a new deposit after the previous deposit was reversed', async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            cashShift: { findMany: jest.fn().mockResolvedValue([{ id: 7, depositLinks: [] }] as never) },
            bankDeposit: { create: jest.fn().mockResolvedValue({ id: 10, status: 'ACTIVE', shifts: [{ shiftId: 7 }] } as never) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        const result = await BankReconciliationService.recordDeposit(1, 5, {
            date: '2026-07-12', amount: 100, bankAccount: 'BAC-1', reference: 'DEP-2', shiftIds: [7]
        });

        expect(result).toEqual(expect.objectContaining({ id: 10, status: 'ACTIVE' }));
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.bankDeposit.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 1, createdById: 5, shifts: { create: [{ shiftId: 7 }] } })
        }));
    });

    it('reverses immutably and keeps the original deposit row', async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            bankDeposit: {
                findFirst: jest.fn().mockResolvedValue({ id: 10, companyId: 1, status: 'ACTIVE' } as never),
                update: jest.fn().mockResolvedValue({ id: 10, status: 'REVERSED' } as never)
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        await BankReconciliationService.reverseDeposit(1, 10, 5, 'Referencia duplicada');
        expect(tx.bankDeposit.update).toHaveBeenCalledWith({
            where: { id: 10 },
            data: expect.objectContaining({ status: 'REVERSED', reversedById: 5, reversalReason: 'Referencia duplicada' })
        });
    });

    it('filters deposit history to deposits wholly belonging to the active branch', async () => {
        const lookup = jest.spyOn(prisma.bankDeposit, 'findMany').mockResolvedValue([] as never);
        await BankReconciliationService.getDeposits(1, 3);
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 1,
                shifts: {
                    some: { shift: { cashRegister: { branchId: 3 } } },
                    every: { shift: { cashRegister: { branchId: 3 } } }
                }
            })
        }));
    });
});
