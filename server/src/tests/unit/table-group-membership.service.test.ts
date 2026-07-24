import { describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { TableGroupService } from '../../services/table-group.service';

const activeGroup = {
    id: 7,
    companyId: 1,
    branchId: 10,
    primaryTableId: 11,
    memberTableIds: [11, 12, 13],
    status: 'ACTIVE',
    activeTables: [{ id: 11 }, { id: 12 }, { id: 13 }]
};

describe('TableGroupService.updateMembership', () => {
    it('can remove the current primary, reassign it and preserve only uninvoiced delivered-unpaid occupancy', async () => {
        const updateMany = jest.fn()
            .mockResolvedValueOnce({ count: 1 } as never)
            .mockResolvedValueOnce({ count: 2 } as never);
        const update = jest.fn().mockResolvedValue({ id: 13, status: 'OCCUPIED' } as never);
        const orderCount = jest.fn().mockResolvedValue(1 as never);
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            tableGroup: {
                findFirst: jest.fn().mockResolvedValue(activeGroup as never),
                update: jest.fn().mockResolvedValue({ id: 7 } as never),
                findUnique: jest.fn().mockResolvedValue({ ...activeGroup, primaryTableId: 12, memberTableIds: [12, 13], activeTables: [{ id: 12 }, { id: 13 }] } as never)
            },
            table: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 11, branchId: 10, status: 'OCCUPIED', activeTableGroupId: 7 },
                    { id: 12, branchId: 10, status: 'OCCUPIED', activeTableGroupId: 7 },
                    { id: 13, branchId: 10, status: 'OCCUPIED', activeTableGroupId: 7 }
                ] as never),
                updateMany,
                findFirst: jest.fn().mockResolvedValue({ status: 'OCCUPIED', activeTableGroupId: null } as never),
                update
            },
            order: { count: orderCount },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 99 } as never) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        const result = await TableGroupService.updateMembership(1, 5, 7, {
            primaryTableId: 12,
            expectedPrimaryTableId: 11,
            memberTableIds: [12, 13],
            expectedMemberTableIds: [13, 12, 11],
            reason: 'Retirar mesa incorrecta'
        });

        expect(result.group).toEqual(expect.objectContaining({ primaryTableId: 12, memberTableIds: [12, 13] }));
        expect(updateMany).toHaveBeenNthCalledWith(1, {
            where: { companyId: 1, id: { in: [11] }, activeTableGroupId: 7 },
            data: { activeTableGroupId: null }
        });
        const occupancyWhere = (orderCount.mock.calls[0]?.[0] as {
            where: {
                companyId: number;
                tableId: number;
                AND: Array<Record<string, unknown>>;
            };
        }).where;
        expect(occupancyWhere).toEqual(expect.objectContaining({ companyId: 1, tableId: 11 }));
        expect(occupancyWhere.AND[0].OR).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'DELIVERED', financialStatus: { not: 'PAID' } })
        ]));
        expect(occupancyWhere.AND[1]).toEqual(expect.objectContaining({
            NOT: expect.objectContaining({
                invoiceNumber: { not: null },
                invoiceFiscalStatus: { not: 'NOT_ISSUED' }
            })
        }));
        expect(update).toHaveBeenCalledWith({ where: { id: 11 }, data: { status: 'OCCUPIED' } });
        expect(tx.tableGroup.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { primaryTableId: 12, memberTableIds: [12, 13] }
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'TABLE_GROUP_UPDATE',
                details: expect.objectContaining({ beforePrimaryTableId: 11, afterPrimaryTableId: 12, beforeTableIds: [11, 12, 13], afterTableIds: [12, 13], removedTableIds: [11] })
            })
        }));
    });

    it('rejects a stale expected group before touching any table', async () => {
        const tableFindMany = jest.fn();
        const tableUpdateMany = jest.fn();
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([] as never),
            user: { findFirst: jest.fn().mockResolvedValue({ id: 5 } as never) },
            tableGroup: { findFirst: jest.fn().mockResolvedValue(activeGroup as never) },
            table: { findMany: tableFindMany, updateMany: tableUpdateMany }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        await expect(TableGroupService.updateMembership(1, 5, 7, {
            primaryTableId: 11,
            expectedPrimaryTableId: 11,
            memberTableIds: [11, 12],
            expectedMemberTableIds: [11, 13],
            reason: 'Vista desactualizada'
        })).rejects.toThrow(/cambió desde que se abrió/i);
        expect(tableFindMany).not.toHaveBeenCalled();
        expect(tableUpdateMany).not.toHaveBeenCalled();
    });
});
