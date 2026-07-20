import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

const ACTIVE_ORDER_STATUSES = ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] as const;
type Tx = Prisma.TransactionClient;

type GroupSelection = {
    primaryTableId: number;
    memberTableIds: number[];
};

type GroupMembershipUpdate = {
    primaryTableId: number;
    expectedPrimaryTableId: number;
    memberTableIds: number[];
    expectedMemberTableIds: number[];
    reason: string;
};

function positiveId(value: unknown, label: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} debe ser un entero mayor a 0`);
    return parsed;
}

export function validateTableGroupSelection(input: GroupSelection): number[] {
    const primaryTableId = positiveId(input.primaryTableId, 'primaryTableId');
    if (!Array.isArray(input.memberTableIds) || input.memberTableIds.length === 0) {
        throw new Error('Seleccione al menos una mesa adicional');
    }
    const memberIds = input.memberTableIds.map((id) => positiveId(id, 'memberTableId'));
    if (memberIds.includes(primaryTableId)) throw new Error('La mesa principal no puede repetirse como integrante');
    if (new Set(memberIds).size !== memberIds.length) throw new Error('No repita mesas en la unión');
    return [primaryTableId, ...memberIds].sort((a, b) => a - b);
}

export function validateUpdatedGroupMembers(memberTableIds: unknown, primaryTableId: number, label = 'memberTableIds'): number[] {
    if (!Array.isArray(memberTableIds) || memberTableIds.length < 2) {
        throw new Error('El grupo debe conservar al menos dos mesas');
    }
    if (memberTableIds.length > 20) throw new Error('No se pueden unir más de 20 mesas en un grupo');
    const ids = memberTableIds.map((id) => positiveId(id, label));
    if (new Set(ids).size !== ids.length) throw new Error('No repita mesas en el grupo');
    if (!ids.includes(primaryTableId)) throw new Error('La mesa principal debe permanecer en el grupo');
    return [...ids].sort((a, b) => a - b);
}

function sameIds(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

const activeAccountWhere = {
    OR: [
        { status: { in: [...ACTIVE_ORDER_STATUSES] } },
        { status: 'DELIVERED' as const, financialStatus: { not: 'PAID' as const } }
    ]
};

async function lockTables(tx: Tx, companyId: number, ids: number[]) {
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
    }
    const tables = await tx.table.findMany({ where: { companyId, id: { in: ids } } });
    if (tables.length !== ids.length) throw new Error('Una o más mesas no existen o no pertenecen a la empresa');
    return tables;
}

async function syncStandaloneTable(tx: Tx, companyId: number, tableId: number) {
    const activeOrders = await tx.order.count({
        where: { companyId, tableId, ...activeAccountWhere }
    });
    const table = await tx.table.findFirst({ where: { id: tableId, companyId }, select: { status: true, activeTableGroupId: true } });
    if (!table || table.activeTableGroupId || table.status === 'RESERVED' || table.status === 'OUT_OF_SERVICE') return;
    await tx.table.update({ where: { id: tableId }, data: { status: activeOrders > 0 ? 'OCCUPIED' : 'AVAILABLE' } });
}

async function closeLockedGroup(
    tx: Tx,
    group: { id: number; companyId: number; branchId: number; primaryTableId: number | null; status: string },
    tables: Array<{ id: number }>,
    actorId: number,
    reason: string
) {
    const tableIds = tables.map((table) => table.id);
    await tx.table.updateMany({
        where: { companyId: group.companyId, activeTableGroupId: group.id },
        data: { activeTableGroupId: null }
    });
    const closed = await tx.tableGroup.update({
        where: { id: group.id },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: actorId, closeReason: reason }
    });
    for (const tableId of tableIds) await syncStandaloneTable(tx, group.companyId, tableId);
    await tx.auditLog.create({
        data: {
            companyId: group.companyId,
            entityType: 'TableGroup',
            entityId: group.id,
            action: 'TABLE_GROUP_CLOSE',
            userId: actorId,
            details: { branchId: group.branchId, primaryTableId: group.primaryTableId, tableIds, reason }
        }
    });
    return { ...closed, tables };
}

export async function keepGroupedTableOccupied(tx: Tx, companyId: number, tableId: number): Promise<void> {
    const table = await tx.table.findFirst({
        where: { id: tableId, companyId },
        select: { activeTableGroupId: true, status: true }
    });
    if (!table) return;
    if (table.activeTableGroupId) {
        if (table.status !== 'RESERVED' && table.status !== 'OUT_OF_SERVICE') {
            await tx.table.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } });
        }
        return;
    }
    await syncStandaloneTable(tx, companyId, tableId);
}

export async function closeInactiveTableGroupForTable(
    tx: Tx,
    companyId: number,
    tableId: number,
    actorId: number,
    reason: string
): Promise<boolean> {
    const table = await tx.table.findFirst({ where: { id: tableId, companyId }, select: { activeTableGroupId: true } });
    if (!table?.activeTableGroupId) {
        await syncStandaloneTable(tx, companyId, tableId);
        return false;
    }
    await tx.$queryRaw`SELECT id FROM \`TableGroup\` WHERE id = ${table.activeTableGroupId} AND companyId = ${companyId} FOR UPDATE`;
    const group = await tx.tableGroup.findFirst({
        where: { id: table.activeTableGroupId, companyId, status: 'ACTIVE' },
        include: { activeTables: { select: { id: true } } }
    });
    if (!group) {
        await tx.table.update({ where: { id: tableId }, data: { activeTableGroupId: null } });
        await syncStandaloneTable(tx, companyId, tableId);
        return false;
    }
    const tableIds = group.activeTables.map((member) => member.id);
    await lockTables(tx, companyId, tableIds);
    const activeOrders = await tx.order.count({
        where: { companyId, tableId: { in: tableIds }, ...activeAccountWhere }
    });
    if (activeOrders > 0) {
        await tx.table.updateMany({
            where: { companyId, activeTableGroupId: group.id },
            data: { status: 'OCCUPIED' }
        });
        return false;
    }
    await closeLockedGroup(tx, group, group.activeTables, actorId, reason);
    return true;
}

export function assertCompatiblePhysicalGroups(
    tables: Array<{ activeTableGroupId: number | null }>,
    operationLabel: string
): void {
    const groupIds = [...new Set(tables.map((table) => table.activeTableGroupId).filter((id): id is number => id !== null))];
    if (groupIds.length === 0) return;
    if (groupIds.length > 1 || tables.some((table) => table.activeTableGroupId === null)) {
        throw new Error(`Separe primero las mesas unidas antes de ${operationLabel} hacia otro grupo`);
    }
}

export class TableGroupService {
    static async getById(companyId: number, groupIdValue: number) {
        const groupId = positiveId(groupIdValue, 'groupId');
        const group = await prisma.tableGroup.findFirst({
            where: { id: groupId, companyId },
            include: { primaryTable: true, activeTables: { orderBy: { number: 'asc' } } }
        });
        if (!group) throw new Error('Grupo de mesas no encontrado');
        return group;
    }

    static async create(
        companyId: number,
        actorId: number,
        data: GroupSelection & { reason?: string }
    ) {
        const tableIds = validateTableGroupSelection(data);
        if (tableIds.length > 20) throw new Error('No se pueden unir más de 20 mesas en un grupo');

        return prisma.$transaction(async (tx) => {
            const actor = await tx.user.findFirst({ where: { id: actorId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            const tables = await lockTables(tx, companyId, tableIds);
            const branchId = tables[0].branchId;
            if (tables.some((table) => table.branchId !== branchId)) throw new Error('Solo se pueden unir mesas de la misma sucursal');
            if (tables.some((table) => table.status === 'OUT_OF_SERVICE')) throw new Error('No se puede unir una mesa fuera de servicio');
            if (tables.some((table) => table.status === 'RESERVED')) throw new Error('No se puede unir una mesa reservada; complete o cancele la reservación');
            if (tables.some((table) => table.activeTableGroupId !== null)) throw new Error('Una de las mesas ya pertenece a otro grupo activo');

            const group = await tx.tableGroup.create({
                data: {
                    companyId,
                    branchId,
                    primaryTableId: data.primaryTableId,
                    memberTableIds: tableIds as Prisma.InputJsonValue,
                    reason: data.reason?.trim() || null,
                    createdById: actorId
                }
            });
            const linked = await tx.table.updateMany({
                where: { companyId, id: { in: tableIds }, activeTableGroupId: null },
                data: { activeTableGroupId: group.id, status: 'OCCUPIED' }
            });
            if (linked.count !== tableIds.length) throw new Error('Las mesas cambiaron mientras se creaba el grupo; recargue e intente nuevamente');
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'TableGroup',
                    entityId: group.id,
                    action: 'TABLE_GROUP_CREATE',
                    userId: actorId,
                    details: { branchId, primaryTableId: data.primaryTableId, tableIds, reason: data.reason?.trim() || null }
                }
            });
            return tx.tableGroup.findUnique({
                where: { id: group.id },
                include: { primaryTable: true, activeTables: { orderBy: { number: 'asc' } } }
            });
        });
    }

    static async close(companyId: number, actorId: number, groupIdValue: number, reason?: string) {
        const groupId = positiveId(groupIdValue, 'groupId');
        return prisma.$transaction(async (tx) => {
            const actor = await tx.user.findFirst({ where: { id: actorId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            await tx.$queryRaw`SELECT id FROM \`TableGroup\` WHERE id = ${groupId} AND companyId = ${companyId} FOR UPDATE`;
            const group = await tx.tableGroup.findFirst({
                where: { id: groupId, companyId },
                include: { activeTables: { select: { id: true } } }
            });
            if (!group) throw new Error('Grupo de mesas no encontrado');
            if (group.status !== 'ACTIVE') throw new Error('El grupo de mesas ya fue separado');
            if (group.activeTables.length < 2) throw new Error('El grupo activo está incompleto; recargue antes de continuar');
            await lockTables(tx, companyId, group.activeTables.map((table) => table.id));
            return closeLockedGroup(
                tx,
                group,
                group.activeTables,
                actorId,
                reason?.trim() || 'Separación manual de mesas'
            );
        });
    }

    static async updateMembership(
        companyId: number,
        actorId: number,
        groupIdValue: number,
        data: GroupMembershipUpdate
    ) {
        const groupId = positiveId(groupIdValue, 'groupId');
        const reason = data.reason?.trim();
        if (!reason || reason.length < 3) throw new Error('Indique un motivo para modificar el grupo');

        return prisma.$transaction(async (tx) => {
            const actor = await tx.user.findFirst({ where: { id: actorId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            await tx.$queryRaw`SELECT id FROM \`TableGroup\` WHERE id = ${groupId} AND companyId = ${companyId} FOR UPDATE`;
            const group = await tx.tableGroup.findFirst({
                where: { id: groupId, companyId },
                include: { activeTables: { select: { id: true }, orderBy: { id: 'asc' } } }
            });
            if (!group) throw new Error('Grupo de mesas no encontrado');
            if (group.status !== 'ACTIVE') throw new Error('El grupo de mesas ya fue separado');
            if (!group.primaryTableId) throw new Error('El grupo activo no tiene una mesa principal válida');

            const currentIds = group.activeTables.map((table) => table.id).sort((a, b) => a - b);
            const storedIds = validateUpdatedGroupMembers(group.memberTableIds, group.primaryTableId, 'storedMemberTableId');
            if (!sameIds(currentIds, storedIds)) throw new Error('El grupo activo está inconsistente; recargue antes de continuar');

            const expectedPrimaryTableId = positiveId(data.expectedPrimaryTableId, 'expectedPrimaryTableId');
            if (expectedPrimaryTableId !== group.primaryTableId) throw new Error('La mesa principal cambió desde que se abrió. Recargue e intente nuevamente');
            const expectedIds = validateUpdatedGroupMembers(data.expectedMemberTableIds, group.primaryTableId, 'expectedMemberTableId');
            if (!sameIds(currentIds, expectedIds)) throw new Error('El grupo cambió desde que se abrió. Recargue e intente nuevamente');

            const desiredPrimaryTableId = positiveId(data.primaryTableId, 'primaryTableId');
            const desiredIds = validateUpdatedGroupMembers(data.memberTableIds, desiredPrimaryTableId);
            if (sameIds(currentIds, desiredIds) && desiredPrimaryTableId === group.primaryTableId) throw new Error('Seleccione un cambio real en las mesas del grupo');

            const affectedIds = [...new Set([...currentIds, ...desiredIds])].sort((a, b) => a - b);
            const tables = await lockTables(tx, companyId, affectedIds);
            const byId = new Map(tables.map((table) => [table.id, table]));
            for (const tableId of desiredIds) {
                const table = byId.get(tableId);
                if (!table || table.branchId !== group.branchId) throw new Error('Solo se pueden unir mesas de la misma sucursal');
                if (table.status === 'OUT_OF_SERVICE') throw new Error('No se puede unir una mesa fuera de servicio');
                if (table.status === 'RESERVED') throw new Error('No se puede unir una mesa reservada; complete o cancele la reservación');
                if (table.activeTableGroupId !== null && table.activeTableGroupId !== group.id) {
                    throw new Error('Una de las mesas ya pertenece a otro grupo activo');
                }
            }

            const removedIds = currentIds.filter((id) => !desiredIds.includes(id));
            const addedIds = desiredIds.filter((id) => !currentIds.includes(id));
            if (removedIds.length) {
                const removed = await tx.table.updateMany({
                    where: { companyId, id: { in: removedIds }, activeTableGroupId: group.id },
                    data: { activeTableGroupId: null }
                });
                if (removed.count !== removedIds.length) throw new Error('Las mesas cambiaron durante la edición; recargue e intente nuevamente');
                for (const tableId of removedIds) await syncStandaloneTable(tx, companyId, tableId);
            }
            if (addedIds.length) {
                const added = await tx.table.updateMany({
                    where: { companyId, id: { in: addedIds }, activeTableGroupId: null },
                    data: { activeTableGroupId: group.id, status: 'OCCUPIED' }
                });
                if (added.count !== addedIds.length) throw new Error('Las mesas cambiaron durante la edición; recargue e intente nuevamente');
            }
            await tx.table.updateMany({
                where: { companyId, id: { in: desiredIds }, activeTableGroupId: group.id },
                data: { status: 'OCCUPIED' }
            });
            await tx.tableGroup.update({
                where: { id: group.id },
                data: { primaryTableId: desiredPrimaryTableId, memberTableIds: desiredIds as Prisma.InputJsonValue }
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'TableGroup',
                    entityId: group.id,
                    action: 'TABLE_GROUP_UPDATE',
                    userId: actorId,
                    details: { branchId: group.branchId, beforePrimaryTableId: group.primaryTableId, afterPrimaryTableId: desiredPrimaryTableId, beforeTableIds: currentIds, afterTableIds: desiredIds, addedTableIds: addedIds, removedTableIds: removedIds, reason }
                }
            });
            const updated = await tx.tableGroup.findUnique({
                where: { id: group.id },
                include: { primaryTable: true, activeTables: { orderBy: { number: 'asc' } } }
            });
            if (!updated) throw new Error('No se pudo recargar el grupo actualizado');
            return { group: updated, affectedTableIds: affectedIds };
        });
    }
}
