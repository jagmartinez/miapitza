import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { SettingService } from '../../services/setting.service';

describe('BankReconciliationService.getReconciliationStatus', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([] as never);
    });

    it('classifies totals by payment method from payments', async () => {
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
        const createdAt = new Date('2026-01-15T12:00:00.000Z');
        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([
            { id: 1, amount: 100, status: 'ACTIVE', createdAt, reversedAt: null, methodType: 'CASH' },
            { id: 2, amount: 40, status: 'ACTIVE', createdAt, reversedAt: null, methodType: 'CARD' },
            { id: 3, amount: 30, status: 'ACTIVE', createdAt, reversedAt: null, methodType: 'BANK_TRANSFER' }
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
            where: expect.objectContaining({ OR: expect.any(Array) })
        }));
        expect(result.totals.totalSales).toBe(170);
        expect(result.totals.byMethod.cash).toBe(100);
        expect(result.totals.byMethod.card).toBe(40);
        expect(result.totals.byMethod.transfer).toBe(30);
    });

    it('books a reversal in the period it happened without rewriting the original sale period', async () => {
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([
            {
                amount: 75,
                status: 'REVERSED',
                createdAt: new Date('2026-01-15T12:00:00.000Z'),
                reversedAt: new Date('2026-02-05T12:00:00.000Z'),
                id: 4,
                methodType: 'CARD'
            }
        ] as never);
        jest.spyOn(prisma.cashShift, 'findMany').mockResolvedValue([] as never);

        const result = await BankReconciliationService.getReconciliationStatus(
            1,
            new Date('2026-02-01T00:00:00.000Z'),
            new Date('2026-02-28T23:59:59.999Z')
        );

        expect(result.totals.grossCollected).toBe(0);
        expect(result.totals.refunded).toBe(75);
        expect(result.totals.netCollected).toBe(-75);
        expect(result.totals.byMethod.card).toBe(-75);
    });

    it('includes catering collections and reversals once, separated by source', async () => {
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([
            {
                id: 10, amount: 30, status: 'ACTIVE', date: new Date('2026-02-10T12:00:00.000Z'), reversedAt: null,
                methodType: 'CASH'
            },
            {
                id: 11, amount: 20, status: 'REVERSED', date: new Date('2026-01-20T12:00:00.000Z'),
                reversedAt: new Date('2026-02-11T12:00:00.000Z'), methodType: 'CARD'
            }
        ] as never);
        jest.spyOn(prisma.cashShift, 'findMany').mockResolvedValue([] as never);

        const result = await BankReconciliationService.getReconciliationStatus(
            1,
            new Date('2026-02-01T00:00:00.000Z'),
            new Date('2026-02-28T23:59:59.999Z')
        );

        expect(result.totals.grossCollected).toBe(30);
        expect(result.totals.refunded).toBe(20);
        expect(result.totals.netCollected).toBe(10);
        expect(result.totals.byMethod).toEqual({ cash: 30, card: -20, transfer: 0, other: 0 });
        expect(result.totals.bySource).toEqual({
            pos: { grossCollected: 0, refunded: 0, netCollected: 0 },
            catering: { grossCollected: 30, refunded: 20, netCollected: 10 }
        });
    });

    it('does not subtract a compensating cash refund twice as an operating expense', async () => {
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
        jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([{
            id: 9,
            amount: 25,
            status: 'REVERSED',
            createdAt: new Date('2026-01-01T12:00:00.000Z'),
            reversedAt: new Date('2026-02-10T12:00:00.000Z'),
            methodType: 'CASH'
        }] as never);
        jest.spyOn(prisma.cashShift, 'findMany').mockResolvedValue([{
            id: 1, startAmount: 50, endAmount: 25,
            cashRegister: { name: 'Caja 1' }, user: { name: 'Cajero' },
            movements: [{ type: 'OUT', amount: 25, reference: 'REV-PAY-9' }]
        }] as never);

        const result = await BankReconciliationService.getReconciliationStatus(
            1,
            new Date('2026-02-01T00:00:00.000Z'),
            new Date('2026-02-28T23:59:59.999Z')
        );

        expect(result.totals.netCollected).toBe(-25);
        expect(result.totals.totalExpenses).toBe(0);
        expect(result.totals.netSales).toBe(-25);
    });
});

describe('BankReconciliationService deposit lifecycle', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);
    });

    it('allows a shift to be linked to a new deposit after the previous deposit was reversed', async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            cashShift: { findMany: jest.fn().mockResolvedValue([{ id: 7, endAmount: 100, depositLinks: [] }] as never) },
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

    it('does not certify shifts against a deposit with a different counted amount', async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            cashShift: { findMany: jest.fn().mockResolvedValue([{ id: 7, endAmount: 80, depositLinks: [] }] as never) },
            bankDeposit: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        await expect(BankReconciliationService.recordDeposit(1, 5, {
            date: '2026-07-12', amount: 100, bankAccount: 'BAC-1', reference: 'DEP-MISMATCH', shiftIds: [7]
        })).rejects.toThrow(/no coincide/i);
        expect(tx.bankDeposit.create).not.toHaveBeenCalled();
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
