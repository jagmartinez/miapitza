import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { TableService } from '../../services/table.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('TableService account-derived occupancy', () => {
    it('does not let a manual status edit release delivered debt', async () => {
        const orderCount = jest.fn().mockResolvedValue(1 as never);
        const tableUpdate = jest.fn();
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            table: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 5,
                    companyId: 1,
                    status: 'OCCUPIED',
                    activeTableGroupId: null,
                } as never),
                update: tableUpdate,
            },
            order: { count: orderCount },
            reservation: { count: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(
            TableService.update(5, 1, { status: 'AVAILABLE' }),
        ).rejects.toThrow('La mesa tiene una cuenta pendiente y debe permanecer ocupada');

        const where = (orderCount.mock.calls[0]?.[0] as {
            where: {
                status: { in: string[] };
                financialStatus: { not: string };
            };
        }).where;
        expect(where.status.in).toContain('DELIVERED');
        expect(where.financialStatus).toEqual({ not: 'PAID' });
        expect(tableUpdate).not.toHaveBeenCalled();
    });
});
