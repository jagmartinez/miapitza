import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { TableGroupService } from '../../services/table-group.service';

/**
 * Real MySQL coverage for selective physical-group editing. Orders are kept on
 * their original tables; only the physical membership and derived table state
 * may change.
 */
describe('Table group membership editing', () => {
    const companyId = 998;
    const branchId = 998;
    const otherBranchId = 999;
    let actorId: number;
    let primaryId: number;
    let openOrderTableId: number;
    let deliveredUnpaidTableId: number;
    let reservedTableId: number;
    let unavailableTableId: number;
    let otherBranchTableId: number;
    let groupId: number;
    let openOrderId: number;
    let deliveredOrderId: number;

    beforeAll(async () => {
        await prisma.company.create({ data: { id: companyId, name: 'Table Group Integration', active: true } });
        await prisma.branch.createMany({ data: [
            { id: branchId, companyId, code: 'TG-IT', name: 'Table Group Branch' },
            { id: otherBranchId, companyId, code: 'TG-OTHER', name: 'Other Branch' }
        ] });
        const role = await prisma.role.create({ data: { companyId, name: 'ADMIN', description: 'Table group integration' } });
        const actor = await prisma.user.create({
            data: {
                companyId,
                branchId,
                roleId: role.id,
                name: 'Table Group Actor',
                email: 'table_group_integration@example.com',
                username: 'table_group_integration',
                password: 'not-used-in-service-test',
                status: 'ACTIVE'
            }
        });
        actorId = actor.id;
        const tables = await Promise.all([
            prisma.table.create({ data: { companyId, branchId, number: 'TG-1', capacity: 4 } }),
            prisma.table.create({ data: { companyId, branchId, number: 'TG-2', capacity: 4 } }),
            prisma.table.create({ data: { companyId, branchId, number: 'TG-3', capacity: 2 } }),
            prisma.table.create({ data: { companyId, branchId, number: 'TG-R', capacity: 4, status: 'RESERVED' } }),
            prisma.table.create({ data: { companyId, branchId, number: 'TG-X', capacity: 4, status: 'OUT_OF_SERVICE' } }),
            prisma.table.create({ data: { companyId, branchId: otherBranchId, number: 'TG-O', capacity: 4 } })
        ]);
        [primaryId, openOrderTableId, deliveredUnpaidTableId, reservedTableId, unavailableTableId, otherBranchTableId] = tables.map((table) => table.id);
        const openOrder = await prisma.order.create({
            data: { companyId, branchId, tableId: openOrderTableId, userId: actorId, status: 'OPEN', financialStatus: 'UNPAID' }
        });
        const deliveredOrder = await prisma.order.create({
            data: { companyId, branchId, tableId: deliveredUnpaidTableId, userId: actorId, status: 'DELIVERED', financialStatus: 'PARTIAL' }
        });
        openOrderId = openOrder.id;
        deliveredOrderId = deliveredOrder.id;
        const group = await TableGroupService.create(companyId, actorId, {
            primaryTableId: primaryId,
            memberTableIds: [openOrderTableId, deliveredUnpaidTableId],
            reason: 'Grupo de integración'
        });
        if (!group) throw new Error('The integration group was not created');
        groupId = group.id;
    });

    afterAll(async () => {
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.table.updateMany({ where: { companyId }, data: { activeTableGroupId: null } });
        await prisma.tableGroup.deleteMany({ where: { companyId } });
        await prisma.table.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    it('removes one member atomically without moving its delivered-unpaid account', async () => {
        const updated = await TableGroupService.updateMembership(companyId, actorId, groupId, {
            primaryTableId: primaryId,
            expectedPrimaryTableId: primaryId,
            memberTableIds: [primaryId, openOrderTableId],
            expectedMemberTableIds: [primaryId, openOrderTableId, deliveredUnpaidTableId],
            reason: 'Retirar mesa agregada por error'
        });

        expect(updated.group.memberTableIds).toEqual([primaryId, openOrderTableId].sort((a, b) => a - b));
        expect(await prisma.table.findUnique({ where: { id: deliveredUnpaidTableId } })).toEqual(expect.objectContaining({
            activeTableGroupId: null,
            status: 'OCCUPIED'
        }));
        expect(await prisma.order.findUnique({ where: { id: deliveredOrderId } })).toEqual(expect.objectContaining({
            tableId: deliveredUnpaidTableId,
            status: 'DELIVERED',
            financialStatus: 'PARTIAL'
        }));
        expect(await prisma.order.findUnique({ where: { id: openOrderId } })).toEqual(expect.objectContaining({ tableId: openOrderTableId }));
        expect(await prisma.auditLog.findFirst({ where: { companyId, entityId: groupId, action: 'TABLE_GROUP_UPDATE' } })).not.toBeNull();
    });

    it('reassigns the primary when the old primary is the table removed by mistake', async () => {
        const updated = await TableGroupService.updateMembership(companyId, actorId, groupId, {
            primaryTableId: openOrderTableId,
            expectedPrimaryTableId: primaryId,
            memberTableIds: [openOrderTableId, deliveredUnpaidTableId],
            expectedMemberTableIds: [primaryId, openOrderTableId],
            reason: 'La mesa principal no pertenecía al grupo'
        });

        expect(updated.group).toEqual(expect.objectContaining({ primaryTableId: openOrderTableId }));
        expect(updated.group.memberTableIds).toEqual([openOrderTableId, deliveredUnpaidTableId].sort((a, b) => a - b));
        expect(await prisma.table.findUnique({ where: { id: primaryId } })).toEqual(expect.objectContaining({
            activeTableGroupId: null,
            status: 'AVAILABLE'
        }));
        expect(await prisma.order.findUnique({ where: { id: openOrderId } })).toEqual(expect.objectContaining({ tableId: openOrderTableId }));
        expect(await prisma.order.findUnique({ where: { id: deliveredOrderId } })).toEqual(expect.objectContaining({ tableId: deliveredUnpaidTableId }));
    });

    it('rejects stale, invalid-state and cross-branch changes without mutating membership', async () => {
        const currentIds = [openOrderTableId, deliveredUnpaidTableId].sort((a, b) => a - b);
        await expect(TableGroupService.updateMembership(companyId, actorId, groupId, {
            primaryTableId: openOrderTableId,
            expectedPrimaryTableId: primaryId,
            memberTableIds: currentIds,
            expectedMemberTableIds: currentIds,
            reason: 'Vista desactualizada'
        })).rejects.toThrow(/principal cambió desde que se abrió/i);

        for (const [candidateId, message] of [
            [reservedTableId, /reservada/i],
            [unavailableTableId, /fuera de servicio/i],
            [otherBranchTableId, /misma sucursal/i]
        ] as const) {
            await expect(TableGroupService.updateMembership(companyId, actorId, groupId, {
                primaryTableId: openOrderTableId,
                expectedPrimaryTableId: openOrderTableId,
                memberTableIds: [openOrderTableId, deliveredUnpaidTableId, candidateId],
                expectedMemberTableIds: currentIds,
                reason: 'Validar contraflujo'
            })).rejects.toThrow(message);
        }

        const group = await prisma.tableGroup.findUnique({ where: { id: groupId } });
        expect(group?.memberTableIds).toEqual(currentIds);
        expect((await prisma.table.findMany({ where: { activeTableGroupId: groupId }, orderBy: { id: 'asc' } })).map((table) => table.id)).toEqual(currentIds);
    });
});
