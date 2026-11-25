import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReservationService } from '../../services/reservation.service';
import { SettingService } from '../../services/setting.service';
import { OrderService } from '../../services/order.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('reservation table ownership boundaries', () => {
    it('does not release a physical RESERVED marker when cancelling a reservation', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            reservation: {
                findFirst: jest.fn(async () => ({
                    id: 12,
                    companyId: 1,
                    tableId: 3,
                    status: 'CONFIRMED',
                    date: new Date()
                })),
                update: jest.fn(async (_args: unknown) => ({ id: 12, status: 'CANCELLED' }))
            },
            table: { update: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await ReservationService.updateStatus(12, 1, 'CANCELLED');

        expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { status: 'CANCELLED' }
        }));
        expect(tx.table.update).not.toHaveBeenCalled();
    });

    it('deletes a pending reservation without changing an unowned table marker', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            reservation: {
                findFirst: jest.fn(async () => ({ id: 12, tableId: 3, status: 'PENDING' })),
                delete: jest.fn(async (_args: unknown) => ({ id: 12 }))
            },
            table: { update: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await ReservationService.delete(12, 1);

        expect(tx.reservation.delete).toHaveBeenCalledWith({ where: { id: 12 } });
        expect(tx.table.update).not.toHaveBeenCalled();
    });

    it('does not allocate a manually RESERVED table to a new near-term reservation', async () => {
        jest.spyOn(SettingService, 'getReservationTableWindowMinutes').mockResolvedValue(90);
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
        const findMany = jest.spyOn(prisma.table, 'findMany').mockResolvedValue([]);
        jest.spyOn(prisma.reservation, 'findMany').mockResolvedValue([]);

        await ReservationService.getAvailableTables(
            2,
            1,
            new Date(Date.now() + 60 * 60 * 1000),
            2
        );

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: [{ status: 'AVAILABLE' }]
            })
        }));
    });

    it('uses the same configured reservation window for allocation and walk-in guards', async () => {
        const configuredMinutes = 45;
        jest.spyOn(SettingService, 'getReservationTableWindowMinutes').mockResolvedValue(configuredMinutes);
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
        jest.spyOn(prisma.table, 'findMany').mockResolvedValue([{ id: 3, status: 'AVAILABLE' }] as never);
        const reservationLookup = jest.spyOn(prisma.reservation, 'findMany').mockResolvedValue([]);
        const requestedDate = new Date(Date.now() + 3 * 60 * 60 * 1000);

        await ReservationService.getAvailableTables(2, 1, requestedDate, 2);

        const allocationWhere = reservationLookup.mock.calls[0][0]!.where!;
        const allocationRange = allocationWhere.date as { gte: Date; lte: Date };
        expect(requestedDate.getTime() - allocationRange.gte.getTime()).toBe(configuredMinutes * 60 * 1000);
        expect(allocationRange.lte.getTime() - requestedDate.getTime()).toBe(configuredMinutes * 60 * 1000);

        const walkInConflicts = jest.fn(async (_args: unknown) => []);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            branch: { findFirst: jest.fn(async () => ({ id: 2 })) },
            table: {
                findFirst: jest.fn(async () => ({ id: 3, branchId: 2, status: 'AVAILABLE' })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            order: {
                findFirst: jest.fn(async () => null),
                create: jest.fn(async () => ({ id: 10 })),
                findUnique: jest.fn(async () => ({ id: 10, items: [] }))
            },
            reservation: { findMany: walkInConflicts },
            setting: { findUnique: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        const before = Date.now();
        await OrderService.create(1, {
            branchId: 2,
            tableId: 3,
            userId: 7,
            orderType: 'DINE_IN',
            items: []
        });
        const after = Date.now();

        const walkInWhere = (walkInConflicts.mock.calls[0][0] as { where: { date: { gt: Date; lt: Date } } }).where;
        expect(walkInWhere.date.gt.getTime()).toBeGreaterThanOrEqual(before - configuredMinutes * 60 * 1000);
        expect(walkInWhere.date.gt.getTime()).toBeLessThanOrEqual(after - configuredMinutes * 60 * 1000);
        expect(walkInWhere.date.lt.getTime()).toBeGreaterThanOrEqual(before + configuredMinutes * 60 * 1000);
        expect(walkInWhere.date.lt.getTime()).toBeLessThanOrEqual(after + configuredMinutes * 60 * 1000);
    });
});
