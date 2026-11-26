import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { CashShiftService } from '../../services/cash-shift.service';
import prisma from '../../utils/prisma';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('CashShiftService manual movement integrity', () => {
    it.each([
        'PAY-10',
        'cat-pay-20',
        'REV-PAY-10',
        'rev-cat-pay-20',
        'CN-REF-NC-1-PAY-10'
    ])('rejects the reserved automatic reference namespace %s', async (reference) => {
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(CashShiftService.addMovement(1, 1, {
            type: 'IN',
            amount: 10,
            description: 'Movimiento manual',
            reference
        })).rejects.toThrow(/namespace reservado/i);

        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects unknown fields before opening a transaction', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(CashShiftService.addMovement(1, 1, {
            type: 'IN',
            amount: 10,
            description: 'Movimiento manual',
            reference: 'MANUAL-1',
            origin: 'POS_PAYMENT'
        } as never)).rejects.toThrow(/campos no permitidos.*origin/i);

        expect(transaction).not.toHaveBeenCalled();
    });

    it('keeps a non-reserved reference and trims it before persistence', async () => {
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
            id: 11,
            ...args.data
        }));
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cashShift: {
                findFirst: jest.fn(async () => ({ id: 1, endDate: null }))
            },
            cashMovement: { create }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await CashShiftService.addMovement(1, 1, {
            type: 'OUT',
            amount: 12.5,
            description: 'Compra menor',
            reference: '  MANUAL-001  '
        });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ reference: 'MANUAL-001' })
        }));
    });
});
