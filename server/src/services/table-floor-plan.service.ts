import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { TableService } from './table.service';

type AreaKind = 'DINING' | 'TERRACE' | 'BAR' | 'PRIVATE' | 'TAKEAWAY' | 'OTHER';
type AreaShape = 'RECTANGLE' | 'ROUNDED' | 'OVAL' | 'L_SHAPE';
type TableShape = 'RECTANGLE' | 'SQUARE' | 'ROUND';

interface AreaInput {
    id?: number;
    clientKey?: string;
    name: string;
    kind?: AreaKind;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    shape?: AreaShape;
    color?: string | null;
    expectedVersion?: number;
}

interface TableInput {
    id: number;
    areaId?: number | null;
    areaClientKey?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    shape?: TableShape;
    expectedVersion: number;
}

interface SaveFloorPlanInput {
    expectedVersion: number;
    canvas: { width: number; height: number };
    areas: AreaInput[];
    deletedAreaIds?: number[];
    tables: TableInput[];
}

function integer(value: unknown, label: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${label} debe ser un entero entre ${min} y ${max}`);
    }
    return parsed;
}

function normalizeColor(value: string | null | undefined): string | null {
    if (!value) return null;
    const color = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error('El color del salón no es válido');
    return color;
}

export class TableFloorPlanService {
    static async getSnapshot(companyId: number, branchId: number) {
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId, status: 'ACTIVE' },
            select: { id: true }
        });
        if (!branch) throw new Error('Sucursal no encontrada o inactiva');

        const [plan, tables] = await Promise.all([
            prisma.tableFloorPlan.findFirst({
                where: { companyId, branchId },
                include: { areas: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } }
            }),
            TableService.getAll(companyId, branchId)
        ]);

        return {
            id: plan?.id ?? null,
            branchId,
            canvasWidth: plan?.canvasWidth ?? 1600,
            canvasHeight: plan?.canvasHeight ?? 1000,
            version: plan?.version ?? 0,
            areas: plan?.areas ?? [],
            tables
        };
    }

    static async save(
        companyId: number,
        branchId: number,
        actorId: number,
        input: SaveFloorPlanInput
    ) {
        if (!input || !Array.isArray(input.areas) || !Array.isArray(input.tables)) {
            throw new Error('El plano debe incluir salones y mesas');
        }
        if (input.areas.length > 50) throw new Error('El plano no admite más de 50 salones');
        if (input.tables.length > 250) throw new Error('El plano no admite más de 250 mesas');

        const canvasWidth = integer(input.canvas?.width, 'Ancho del plano', 640, 10000);
        const canvasHeight = integer(input.canvas?.height, 'Alto del plano', 480, 10000);
        const expectedVersion = integer(input.expectedVersion, 'Versión del plano', 0, 1_000_000_000);
        const names = input.areas.map((area) => String(area.name || '').trim());
        if (names.some((name) => !name || name.length > 100)) throw new Error('Cada salón debe tener un nombre de 1 a 100 caracteres');
        if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
            throw new Error('No pueden existir salones con el mismo nombre');
        }

        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Branch\` WHERE id = ${branchId} AND companyId = ${companyId} FOR UPDATE`;
            const branch = await tx.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!branch) throw new Error('Sucursal no encontrada o inactiva');

            let plan = await tx.tableFloorPlan.findFirst({ where: { companyId, branchId } });
            if (!plan) {
                if (expectedVersion !== 0) throw new Error('El plano cambió; recarga antes de guardar');
                plan = await tx.tableFloorPlan.create({
                    data: { companyId, branchId, canvasWidth, canvasHeight }
                });
            } else if (plan.version !== expectedVersion) {
                throw new Error('El plano fue modificado desde otro dispositivo; recarga antes de guardar');
            }

            const persistedIds = input.areas.filter((area) => area.id).map((area) => integer(area.id, 'ID de salón', 1, 1_000_000_000));
            if (persistedIds.length) {
                await tx.$queryRawUnsafe(
                    `SELECT id FROM \`FloorArea\` WHERE id IN (${persistedIds.map(() => '?').join(',')}) FOR UPDATE`,
                    ...persistedIds
                );
            }
            const existingAreas = persistedIds.length
                ? await tx.floorArea.findMany({ where: { id: { in: persistedIds }, floorPlanId: plan.id, companyId, branchId } })
                : [];
            if (existingAreas.length !== persistedIds.length) throw new Error('Uno o más salones no pertenecen al plano activo');
            const existingById = new Map(existingAreas.map((area) => [area.id, area]));
            const areaIdByClientKey = new Map<string, number>();

            for (const [index, raw] of input.areas.entries()) {
                const x = integer(raw.x, `Posición X de ${names[index]}`, 0, canvasWidth);
                const y = integer(raw.y, `Posición Y de ${names[index]}`, 0, canvasHeight);
                const width = integer(raw.width, `Ancho de ${names[index]}`, 160, canvasWidth);
                const height = integer(raw.height, `Alto de ${names[index]}`, 140, canvasHeight);
                const rotation = integer(raw.rotation ?? 0, `Rotación de ${names[index]}`, 0, 359);
                if (x + width > canvasWidth + 400 || y + height > canvasHeight + 400) throw new Error(`El salón ${names[index]} queda fuera del plano`);
                const kind = raw.kind ?? 'DINING';
                const shape = raw.shape ?? 'RECTANGLE';
                if (!['DINING', 'TERRACE', 'BAR', 'PRIVATE', 'TAKEAWAY', 'OTHER'].includes(kind)) throw new Error('Tipo de salón no válido');
                if (!['RECTANGLE', 'ROUNDED', 'OVAL', 'L_SHAPE'].includes(shape)) throw new Error('Forma de salón no válida');

                if (raw.id) {
                    const id = Number(raw.id);
                    const current = existingById.get(id)!;
                    const areaVersion = integer(raw.expectedVersion ?? current.mapVersion, 'Versión del salón', 0, 1_000_000_000);
                    if (current.mapVersion !== areaVersion) throw new Error(`El salón ${current.name} cambió en otro dispositivo`);
                    const result = await tx.floorArea.updateMany({
                        where: { id, floorPlanId: plan.id, mapVersion: areaVersion },
                        data: {
                            name: names[index], kind, mapX: x, mapY: y, mapWidth: width, mapHeight: height,
                            mapRotation: rotation, mapShape: shape, color: normalizeColor(raw.color), mapVersion: { increment: 1 }
                        }
                    });
                    if (result.count !== 1) throw new Error(`Conflicto al guardar el salón ${current.name}`);
                } else {
                    const clientKey = String(raw.clientKey || '').trim();
                    if (!clientKey || areaIdByClientKey.has(clientKey)) throw new Error('Cada salón nuevo requiere una clave temporal única');
                    const created = await tx.floorArea.create({
                        data: {
                            floorPlanId: plan.id, companyId, branchId, name: names[index], kind,
                            mapX: x, mapY: y, mapWidth: width, mapHeight: height,
                            mapRotation: rotation, mapShape: shape, color: normalizeColor(raw.color)
                        }
                    });
                    areaIdByClientKey.set(clientKey, created.id);
                }
            }

            const tableIds = input.tables.map((table) => integer(table.id, 'ID de mesa', 1, 1_000_000_000));
            if (new Set(tableIds).size !== tableIds.length) throw new Error('No repita mesas en el plano');
            if (tableIds.length) {
                for (const id of [...tableIds].sort((a, b) => a - b)) {
                    await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
                }
            }
            const currentTables = tableIds.length ? await tx.table.findMany({ where: { id: { in: tableIds }, companyId, branchId } }) : [];
            if (currentTables.length !== tableIds.length) throw new Error('Una o más mesas no pertenecen a la sucursal activa');
            const currentTableById = new Map(currentTables.map((table) => [table.id, table]));
            const validAreaIds = new Set([
                ...persistedIds,
                ...Array.from(areaIdByClientKey.values())
            ]);

            for (const raw of input.tables) {
                const current = currentTableById.get(raw.id)!;
                const x = integer(raw.x, `Posición X de mesa ${current.number}`, 0, canvasWidth);
                const y = integer(raw.y, `Posición Y de mesa ${current.number}`, 0, canvasHeight);
                let width = integer(raw.width, `Ancho de mesa ${current.number}`, 56, 400);
                let height = integer(raw.height, `Alto de mesa ${current.number}`, 56, 400);
                const rotation = integer(raw.rotation ?? 0, `Rotación de mesa ${current.number}`, 0, 359);
                const shape = raw.shape ?? current.mapShape;
                if (!['RECTANGLE', 'SQUARE', 'ROUND'].includes(shape)) throw new Error('Forma de mesa no válida');
                if (shape === 'SQUARE' || shape === 'ROUND') width = height = Math.max(width, height);
                const tableVersion = integer(raw.expectedVersion, 'Versión de mesa', 0, 1_000_000_000);
                if (current.mapVersion !== tableVersion) throw new Error(`La mesa ${current.number} cambió en otro dispositivo`);

                const areaId = raw.areaClientKey
                    ? areaIdByClientKey.get(raw.areaClientKey)
                    : (raw.areaId ?? null);
                if (areaId != null && !validAreaIds.has(areaId)) throw new Error(`El salón asignado a la mesa ${current.number} no es válido`);
                const result = await tx.table.updateMany({
                    where: { id: raw.id, companyId, branchId, mapVersion: tableVersion },
                    data: {
                        floorAreaId: areaId, mapX: x, mapY: y, mapWidth: width, mapHeight: height,
                        mapRotation: rotation, mapShape: shape, mapVersion: { increment: 1 }, layoutUpdatedAt: new Date()
                    }
                });
                if (result.count !== 1) throw new Error(`Conflicto al guardar la mesa ${current.number}`);
            }

            const deletedAreaIds = [...new Set((input.deletedAreaIds || []).map((id) => integer(id, 'Salón eliminado', 1, 1_000_000_000)))];
            if (deletedAreaIds.length) {
                const deletable = await tx.floorArea.findMany({ where: { id: { in: deletedAreaIds }, floorPlanId: plan.id, companyId, branchId }, select: { id: true } });
                if (deletable.length !== deletedAreaIds.length) throw new Error('Uno o más salones eliminados no pertenecen al plano');
                await tx.table.updateMany({ where: { companyId, branchId, floorAreaId: { in: deletedAreaIds } }, data: { floorAreaId: null } });
                await tx.floorArea.deleteMany({ where: { id: { in: deletedAreaIds }, floorPlanId: plan.id } });
            }

            const planUpdate = await tx.tableFloorPlan.updateMany({
                where: { id: plan.id, version: expectedVersion },
                data: { canvasWidth, canvasHeight, version: { increment: 1 } }
            });
            if (planUpdate.count !== 1) throw new Error('Conflicto al guardar el plano; recarga e intenta nuevamente');

            await tx.auditLog.create({
                data: {
                    companyId, entityType: 'TableFloorPlan', entityId: plan.id,
                    action: 'FLOOR_PLAN_UPDATE', userId: actorId,
                    details: { branchId, expectedVersion, canvas: { width: canvasWidth, height: canvasHeight }, areas: input.areas.length, tables: input.tables.length, deletedAreaIds } as Prisma.InputJsonValue
                }
            });
        });

        return this.getSnapshot(companyId, branchId);
    }
}
