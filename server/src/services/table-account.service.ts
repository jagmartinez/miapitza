import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import prisma from '../utils/prisma';
import { assertCompatiblePhysicalGroups, keepGroupedTableOccupied } from './table-group.service';
import {
    TABLE_OPERATIONAL_ORDER_STATUSES,
    tableOpenAccountWhere,
    type TableOperationalOrderStatus,
} from './table-occupancy-policy';

const ACTIVE_STATUSES = TABLE_OPERATIONAL_ORDER_STATUSES;
type ActiveStatus = TableOperationalOrderStatus;

interface LayoutInput {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    shape?: 'RECTANGLE' | 'SQUARE' | 'ROUND';
    expectedVersion: number;
}

interface TransferSlice {
    orderItemId: number;
    quantity: number;
}

type Tx = Prisma.TransactionClient;

type ConsolidationFingerprintItem = {
    id: number;
    quantity: number;
    price: Prisma.Decimal | number | string;
    subtotal: Prisma.Decimal | number | string;
    notes: string | null;
    status: string;
    sentAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    modifiers: Array<{
        id: number;
        modifierId: number;
        name: string;
        price: Prisma.Decimal | number | string;
    }>;
};

function toCents(value: Prisma.Decimal | number | string): number {
    const normalized = typeof value === 'object' && 'toFixed' in value
        ? value.toFixed(2)
        : Number(value).toFixed(2);
    const negative = normalized.startsWith('-');
    const [whole, fraction = '00'] = normalized.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
    return negative ? -cents : cents;
}

function fromCents(value: number): Prisma.Decimal {
    return new Prisma.Decimal((value / 100).toFixed(2));
}

function sumCents(values: Array<Prisma.Decimal | number | string>): number {
    return values.reduce<number>((total, value) => total + toCents(value), 0);
}

function itemFingerprint(item: ConsolidationFingerprintItem): string {
    const canonical = {
        id: item.id,
        quantity: item.quantity,
        price: toCents(item.price),
        subtotal: toCents(item.subtotal),
        notes: item.notes,
        status: item.status,
        sentAt: item.sentAt?.toISOString() ?? null,
        startedAt: item.startedAt?.toISOString() ?? null,
        finishedAt: item.finishedAt?.toISOString() ?? null,
        modifiers: [...item.modifiers]
            .sort((left, right) => left.id - right.id)
            .map((modifier) => ({
                id: modifier.id,
                modifierId: modifier.modifierId,
                name: modifier.name,
                price: toCents(modifier.price)
            }))
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function sameInstant(left: Date, right: Date): boolean {
    return left.getTime() === right.getTime();
}

export function allocatePartialFinancials(input: {
    originalTotalCents: number;
    sourceSubtotalCents: number;
    movedSubtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
}) {
    const ratio = input.movedSubtotalCents / input.sourceSubtotalCents;
    const movedDiscountCents = Math.round(input.discountCents * ratio);
    const movedTaxCents = Math.round(input.taxCents * ratio);
    const movedTipCents = Math.round(input.tipCents * ratio);
    const movedTotalCents = input.movedSubtotalCents
        - movedDiscountCents
        + movedTaxCents
        + movedTipCents;
    return {
        ratio,
        movedDiscountCents,
        movedTaxCents,
        movedTipCents,
        movedTotalCents,
        sourceTotalCents: input.originalTotalCents - movedTotalCents,
    };
}

function workflowStatus(statuses: ActiveStatus[]): ActiveStatus {
    if (statuses.length > 0 && statuses.every((status) => status === 'READY')) return 'READY';
    if (statuses.includes('IN_PREPARATION') || statuses.includes('READY')) return 'IN_PREPARATION';
    if (statuses.includes('SENT_TO_KITCHEN')) return 'SENT_TO_KITCHEN';
    return 'OPEN';
}

function assertPositiveInteger(value: unknown, label: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} debe ser un entero mayor a 0`);
    return parsed;
}

async function lockTables(tx: Tx, companyId: number, ids: number[]) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    for (const id of sorted) {
        await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
    }
    const tables = await tx.table.findMany({ where: { companyId, id: { in: sorted } } });
    if (tables.length !== sorted.length) throw new Error('Una o más mesas no existen o no pertenecen a la empresa');
    return tables;
}

async function lockOrders(tx: Tx, companyId: number, ids: number[]) {
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
    }
}

async function syncTableStatus(tx: Tx, companyId: number, tableId: number) {
    await keepGroupedTableOccupied(tx, companyId, tableId);
}

function validateMutableOrder(order: {
    invoiceNumber: string | null;
    financialStatus: string;
    payments: Array<{ id: number }>;
    status: string;
}) {
    if (!ACTIVE_STATUSES.includes(order.status as ActiveStatus)) {
        throw new Error('Solo se pueden mover o consolidar órdenes operativas activas');
    }
    if (order.invoiceNumber) throw new Error('No se puede modificar una orden ya facturada');
    if (order.financialStatus !== 'UNPAID' || order.payments.length > 0) {
        throw new Error('No se puede modificar una orden con pagos registrados');
    }
}

export class TableAccountService {
    static async updateLayout(
        companyId: number,
        branchId: number,
        actorId: number,
        entries: LayoutInput[]
    ) {
        if (!Array.isArray(entries) || entries.length === 0) throw new Error('Incluya al menos una mesa');
        if (entries.length > 250) throw new Error('No se pueden actualizar más de 250 mesas por operación');
        const ids = entries.map((entry) => assertPositiveInteger(entry.id, 'id'));
        if (new Set(ids).size !== ids.length) throw new Error('No repita mesas en la actualización del plano');

        return prisma.$transaction(async (tx) => {
            const tables = await lockTables(tx, companyId, ids);
            if (tables.some((table) => table.branchId !== branchId)) {
                throw new Error('Todas las mesas deben pertenecer a la sucursal activa');
            }

            const currentById = new Map(tables.map((table) => [table.id, table]));
            for (const entry of entries) {
                const x = Number(entry.x);
                const y = Number(entry.y);
                const width = Number(entry.width);
                const height = Number(entry.height);
                const rotation = Number(entry.rotation ?? 0);
                const expectedVersion = Number(entry.expectedVersion);
                if (![x, y, width, height, rotation, expectedVersion].every(Number.isInteger)) {
                    throw new Error('La geometría y versión del plano deben ser números enteros');
                }
                if (x < 0 || y < 0 || x > 10000 || y > 10000) throw new Error('La posición de la mesa está fuera del plano');
                if (width < 56 || height < 56 || width > 400 || height > 400) {
                    throw new Error('El tamaño de la mesa debe estar entre 56 y 400 píxeles');
                }
                if (rotation < 0 || rotation > 359) throw new Error('La rotación debe estar entre 0 y 359 grados');
                if (entry.shape && !['RECTANGLE', 'SQUARE', 'ROUND'].includes(entry.shape)) {
                    throw new Error('Forma de mesa no válida');
                }

                const current = currentById.get(entry.id)!;
                if (current.mapVersion !== expectedVersion) {
                    throw new Error(`El plano cambió en otro dispositivo para la mesa ${current.number}; recargue antes de guardar`);
                }
                const updated = await tx.table.updateMany({
                    where: { id: entry.id, companyId, mapVersion: expectedVersion },
                    data: {
                        mapX: x,
                        mapY: y,
                        mapWidth: width,
                        mapHeight: height,
                        mapRotation: rotation,
                        ...(entry.shape ? { mapShape: entry.shape } : {}),
                        mapVersion: { increment: 1 },
                        layoutUpdatedAt: new Date()
                    }
                });
                if (updated.count !== 1) throw new Error('Conflicto de concurrencia al guardar el plano; recargue e intente nuevamente');

                await tx.auditLog.create({
                    data: {
                        companyId,
                        entityType: 'Table',
                        entityId: entry.id,
                        action: 'LAYOUT_UPDATE',
                        userId: actorId,
                        details: {
                            before: {
                                x: current.mapX, y: current.mapY, width: current.mapWidth,
                                height: current.mapHeight, rotation: current.mapRotation,
                                shape: current.mapShape, version: current.mapVersion
                            },
                            after: { x, y, width, height, rotation, shape: entry.shape ?? current.mapShape }
                        }
                    }
                });
            }

            // Keep the branch-level floor-plan version in sync for legacy
            // clients that still call PUT /tables/layout during rolling deploys.
            await tx.tableFloorPlan.upsert({
                where: { branchId },
                create: { companyId, branchId, version: 1 },
                update: { version: { increment: 1 } }
            });

            return tx.table.findMany({
                where: { companyId, branchId, id: { in: ids } },
                orderBy: { number: 'asc' }
            });
        });
    }

    static async consolidate(
        companyId: number,
        actorId: number,
        data: { destinationTableId: number; sourceTableIds: number[]; primaryOrderId?: number; reason?: string }
    ) {
        const destinationTableId = assertPositiveInteger(data.destinationTableId, 'destinationTableId');
        if (!Array.isArray(data.sourceTableIds) || data.sourceTableIds.length === 0) {
            throw new Error('Seleccione al menos una mesa de origen');
        }
        const sourceTableIds = data.sourceTableIds.map((id) => assertPositiveInteger(id, 'sourceTableId'));
        if (new Set(sourceTableIds).size !== sourceTableIds.length) throw new Error('No repita mesas de origen');
        if (sourceTableIds.includes(destinationTableId)) throw new Error('La mesa destino no puede ser también origen');

        return prisma.$transaction(async (tx) => {
            const tables = await lockTables(tx, companyId, [destinationTableId, ...sourceTableIds]);
            const destination = tables.find((table) => table.id === destinationTableId)!;
            assertCompatiblePhysicalGroups(tables, 'consolidar cuentas');
            if (destination.status === 'OUT_OF_SERVICE') throw new Error('La mesa destino está fuera de servicio');
            if (destination.status === 'RESERVED') throw new Error('La mesa destino está reservada');
            if (tables.some((table) => table.branchId !== destination.branchId)) {
                throw new Error('Solo se pueden consolidar mesas de la misma sucursal');
            }

            const orders = await tx.order.findMany({
                where: {
                    companyId,
                    tableId: { in: [destinationTableId, ...sourceTableIds] },
                    ...tableOpenAccountWhere()
                },
                include: {
                    payments: { where: { status: 'ACTIVE' }, select: { id: true } },
                    items: {
                        select: {
                            id: true,
                            quantity: true,
                            price: true,
                            subtotal: true,
                            notes: true,
                            status: true,
                            sentAt: true,
                            startedAt: true,
                            finishedAt: true,
                            originOrderId: true,
                            originTableId: true,
                            modifiers: {
                                select: { id: true, modifierId: true, name: true, price: true },
                                orderBy: { id: 'asc' }
                            }
                        }
                    }
                }
            });
            const orderTableIds = new Set(orders.map((order) => order.tableId));
            for (const sourceId of sourceTableIds) {
                if (!orderTableIds.has(sourceId)) throw new Error(`La mesa de origen #${sourceId} no tiene una orden activa`);
            }
            if (orders.length < 2) throw new Error('Se necesitan al menos dos órdenes activas para consolidar');
            await lockOrders(tx, companyId, orders.map((order) => order.id));
            orders.forEach(validateMutableOrder);
            if (orders.some((order) => order.discountCode)) {
                throw new Error('Las órdenes con promociones deben revisarse y retirarse antes de consolidar');
            }

            const requestedPrimary = data.primaryOrderId
                ? orders.find((order) => order.id === Number(data.primaryOrderId))
                : undefined;
            if (data.primaryOrderId && !requestedPrimary) throw new Error('La orden principal no pertenece a las mesas seleccionadas');
            const primary = requestedPrimary
                ?? orders.find((order) => order.tableId === destinationTableId)
                ?? orders[0];
            const secondary = orders.filter((order) => order.id !== primary.id);
            const orderIds = orders.map((order) => order.id);
            const activeConsolidation = await tx.tableConsolidation.findFirst({
                where: {
                    companyId,
                    status: 'ACTIVE',
                    OR: [
                        { primaryOrderId: { in: orderIds } },
                        { orderSnapshots: { some: { orderId: { in: orderIds } } } }
                    ]
                },
                select: { id: true }
            });
            if (activeConsolidation) {
                throw new Error(`La consolidación #${activeConsolidation.id} debe revertirse antes de volver a consolidar estas órdenes`);
            }
            const movedItemIds: number[] = [];
            const postUpdateByOrderId = new Map<number, Date>();

            for (const source of secondary) {
                const itemIds = source.items.map((item) => item.id);
                movedItemIds.push(...itemIds);
                if (itemIds.length > 0) {
                    await tx.orderItem.updateMany({
                        where: { id: { in: itemIds }, orderId: source.id, originOrderId: null },
                        data: { originOrderId: source.id }
                    });
                    await tx.orderItem.updateMany({
                        where: { id: { in: itemIds }, orderId: source.id, originTableId: null },
                        data: { originTableId: source.tableId }
                    });
                    await tx.orderItem.updateMany({
                        where: { id: { in: itemIds }, orderId: source.id },
                        data: { orderId: primary.id }
                    });
                }
                const updatedSource = await tx.order.update({
                    where: { id: source.id },
                    data: {
                        status: 'CANCELLED',
                        total: 0,
                        discount: 0,
                        tax: 0,
                        tipAmount: 0,
                        channelCommission: 0,
                        channelMarkup: 0,
                        consolidatedIntoOrderId: primary.id,
                        cancelledById: actorId,
                        cancelledAt: new Date(),
                        closedAt: new Date(),
                        cancelReason: `Consolidada en orden #${primary.id}`
                    }
                });
                postUpdateByOrderId.set(source.id, updatedSource.updatedAt);
            }

            const updatedPrimary = await tx.order.update({
                where: { id: primary.id },
                data: {
                    tableId: destinationTableId,
                    status: workflowStatus(orders.map((order) => order.status as ActiveStatus)),
                    total: fromCents(sumCents(orders.map((order) => order.total))),
                    discount: fromCents(sumCents(orders.map((order) => order.discount))),
                    tax: fromCents(sumCents(orders.map((order) => order.tax))),
                    tipAmount: fromCents(sumCents(orders.map((order) => order.tipAmount))),
                    channelCommission: fromCents(sumCents(orders.map((order) => order.channelCommission))),
                    channelMarkup: fromCents(sumCents(orders.map((order) => order.channelMarkup)))
                },
                include: { table: true, items: { include: { menuItem: true, modifiers: true } } }
            });
            postUpdateByOrderId.set(primary.id, updatedPrimary.updatedAt);

            const consolidation = await tx.tableConsolidation.create({
                data: {
                    companyId,
                    branchId: destination.branchId,
                    primaryOrderId: primary.id,
                    destinationTableId,
                    reason: data.reason?.trim() || null,
                    createdById: actorId,
                    orderSnapshots: {
                        create: orders.map((order) => {
                            if (order.tableId === null) throw new Error(`La orden #${order.id} no conserva una mesa de origen`);
                            const postConsolidationUpdatedAt = postUpdateByOrderId.get(order.id);
                            if (!postConsolidationUpdatedAt) throw new Error(`No se pudo versionar la orden #${order.id}`);
                            return {
                                orderId: order.id,
                                originalTableId: order.tableId,
                                isPrimary: order.id === primary.id,
                                originalStatus: order.status,
                                originalFinancialStatus: order.financialStatus,
                                originalTotal: order.total,
                                originalDiscount: order.discount,
                                originalTax: order.tax,
                                originalTipAmount: order.tipAmount,
                                originalChannelCommission: order.channelCommission,
                                originalChannelMarkup: order.channelMarkup,
                                originalConsolidatedIntoId: order.consolidatedIntoOrderId,
                                originalCancelledById: order.cancelledById,
                                originalCancelledAt: order.cancelledAt,
                                originalClosedAt: order.closedAt,
                                originalCancelReason: order.cancelReason,
                                postConsolidationUpdatedAt
                            };
                        })
                    },
                    itemSnapshots: {
                        create: orders.flatMap((order) => order.items.map((item) => ({
                            orderItemId: item.id,
                            sourceOrderId: order.id,
                            previousOriginOrderId: item.originOrderId,
                            previousOriginTableId: item.originTableId,
                            itemFingerprint: itemFingerprint(item)
                        })))
                    }
                },
                select: { id: true, version: true }
            });

            await syncTableStatus(tx, companyId, destinationTableId);
            for (const sourceId of sourceTableIds) await syncTableStatus(tx, companyId, sourceId);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: primary.id,
                    action: 'TABLE_CONSOLIDATE',
                    userId: actorId,
                    details: {
                        destinationTableId,
                        sourceTableIds,
                        primaryOrderId: primary.id,
                        consolidationId: consolidation.id,
                        absorbedOrderIds: secondary.map((order) => order.id),
                        movedItemIds,
                        reason: data.reason?.trim() || null
                    }
                }
            });
            return {
                ...updatedPrimary,
                consolidationId: consolidation.id,
                consolidationVersion: consolidation.version
            };
        });
    }

    static async getConsolidation(companyId: number, consolidationIdValue: number) {
        const consolidationId = assertPositiveInteger(consolidationIdValue, 'consolidationId');
        const consolidation = await prisma.tableConsolidation.findFirst({
            where: { id: consolidationId, companyId },
            include: {
                orderSnapshots: { orderBy: { orderId: 'asc' } },
                itemSnapshots: { orderBy: { orderItemId: 'asc' } }
            }
        });
        if (!consolidation) throw new Error('Consolidación de mesas no encontrada');
        return consolidation;
    }

    static async findActiveConsolidation(
        companyId: number,
        query: { orderId?: number; tableId?: number }
    ) {
        const hasOrderId = query.orderId !== undefined;
        const hasTableId = query.tableId !== undefined;
        if (hasOrderId === hasTableId) {
            throw new Error('Indique exactamente orderId o tableId para buscar la consolidación');
        }

        const orderId = hasOrderId ? assertPositiveInteger(query.orderId, 'orderId') : undefined;
        const tableId = hasTableId ? assertPositiveInteger(query.tableId, 'tableId') : undefined;
        const consolidation = await prisma.tableConsolidation.findFirst({
            where: {
                companyId,
                status: 'ACTIVE',
                ...(orderId !== undefined
                    ? {
                        OR: [
                            { primaryOrderId: orderId },
                            { orderSnapshots: { some: { orderId } } }
                        ]
                    }
                    : {
                        OR: [
                            { destinationTableId: tableId! },
                            { orderSnapshots: { some: { originalTableId: tableId! } } }
                        ]
                    })
            },
            select: {
                id: true,
                branchId: true,
                primaryOrderId: true,
                destinationTableId: true,
                status: true,
                version: true,
                reason: true,
                createdAt: true,
                orderSnapshots: {
                    select: { orderId: true, originalTableId: true },
                    orderBy: { orderId: 'asc' }
                }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        if (!consolidation) return null;

        return {
            id: consolidation.id,
            branchId: consolidation.branchId,
            primaryOrderId: consolidation.primaryOrderId,
            destinationTableId: consolidation.destinationTableId,
            status: consolidation.status,
            version: consolidation.version,
            reason: consolidation.reason,
            createdAt: consolidation.createdAt,
            affectedOrderIds: consolidation.orderSnapshots.map((snapshot) => snapshot.orderId),
            originalTableIds: [...new Set(consolidation.orderSnapshots.map((snapshot) => snapshot.originalTableId))]
        };
    }

    static async reverseConsolidation(
        companyId: number,
        actorId: number,
        consolidationIdValue: number,
        data: { expectedVersion: number; reversalKey: string; reason: string }
    ) {
        const consolidationId = assertPositiveInteger(consolidationIdValue, 'consolidationId');
        const expectedVersion = Number(data.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
            throw new Error('expectedVersion debe ser un entero mayor o igual a 0');
        }
        const reversalKey = data.reversalKey?.trim();
        if (!reversalKey || reversalKey.length < 8 || reversalKey.length > 191) {
            throw new Error('La clave idempotente de reversión no es válida');
        }
        const reason = data.reason?.trim();
        if (!reason || reason.length < 3 || reason.length > 500) {
            throw new Error('El motivo de reversión debe tener entre 3 y 500 caracteres');
        }

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`TableConsolidation\` WHERE id = ${consolidationId} AND companyId = ${companyId} FOR UPDATE`;
            const consolidation = await tx.tableConsolidation.findFirst({
                where: { id: consolidationId, companyId },
                include: {
                    orderSnapshots: { orderBy: { orderId: 'asc' } },
                    itemSnapshots: { orderBy: { orderItemId: 'asc' } }
                }
            });
            if (!consolidation) throw new Error('Consolidación de mesas no encontrada');

            if (consolidation.status === 'REVERSED') {
                if (consolidation.reversalKey !== reversalKey || consolidation.reversalReason !== reason) {
                    throw new Error('La consolidación ya fue revertida con otra clave o motivo');
                }
                const orders = await tx.order.findMany({
                    where: { companyId, id: { in: consolidation.orderSnapshots.map((snapshot) => snapshot.orderId) } },
                    orderBy: { id: 'asc' }
                });
                return {
                    idempotent: true,
                    consolidationId,
                    version: consolidation.version,
                    primaryOrderId: consolidation.primaryOrderId,
                    affectedTableIds: [...new Set(consolidation.orderSnapshots.map((snapshot) => snapshot.originalTableId))],
                    orders
                };
            }
            if (consolidation.version !== expectedVersion) {
                throw new Error('La consolidación cambió en otro proceso; recargue antes de revertir');
            }

            const reusedKey = await tx.tableConsolidation.findFirst({
                where: { companyId, reversalKey, id: { not: consolidationId } },
                select: { id: true }
            });
            if (reusedKey) throw new Error(`La clave de reversión ya fue usada por la consolidación #${reusedKey.id}`);

            const orderIds = consolidation.orderSnapshots.map((snapshot) => snapshot.orderId);
            const tableIds = [...new Set([
                consolidation.destinationTableId,
                ...consolidation.orderSnapshots.map((snapshot) => snapshot.originalTableId)
            ])];
            const tables = await lockTables(tx, companyId, tableIds);
            if (tables.some((table) => table.branchId !== consolidation.branchId)) {
                throw new Error('Las mesas históricas ya no pertenecen a la sucursal de la consolidación');
            }
            if (tables.some((table) => table.status === 'RESERVED' || table.status === 'OUT_OF_SERVICE')) {
                throw new Error('No se puede revertir hacia una mesa reservada o fuera de servicio');
            }

            await lockOrders(tx, companyId, orderIds);
            const currentOrders = await tx.order.findMany({
                where: { companyId, id: { in: orderIds } },
                include: { payments: { select: { id: true } } }
            });
            if (currentOrders.length !== orderIds.length) {
                throw new Error('Una de las órdenes históricas ya no existe o pertenece a otra empresa');
            }
            const currentById = new Map(currentOrders.map((order) => [order.id, order]));
            const primarySnapshot = consolidation.orderSnapshots.find((snapshot) => snapshot.isPrimary);
            if (!primarySnapshot || primarySnapshot.orderId !== consolidation.primaryOrderId) {
                throw new Error('La consolidación no conserva una orden principal íntegra');
            }

            for (const snapshot of consolidation.orderSnapshots) {
                const current = currentById.get(snapshot.orderId)!;
                if (!sameInstant(current.updatedAt, snapshot.postConsolidationUpdatedAt)) {
                    throw new Error(`La orden #${current.id} cambió después de consolidarse`);
                }
                if (current.payments.length > 0 || current.financialStatus !== 'UNPAID') {
                    throw new Error(`La orden #${current.id} tiene historial de pago y no puede separarse`);
                }
                if (current.invoiceNumber || current.invoicedAt || current.invoiceFiscalStatus !== 'NOT_ISSUED') {
                    throw new Error(`La orden #${current.id} ya tiene historia fiscal y no puede separarse`);
                }
                if (snapshot.isPrimary) {
                    if (current.status === 'DELIVERED') {
                        throw new Error('No se puede revertir una consolidación después de entregar la cuenta, aunque siga pendiente de pago');
                    }
                    if (!ACTIVE_STATUSES.includes(current.status as ActiveStatus)) {
                        throw new Error('La orden principal ya no está en un estado operativo reversible');
                    }
                } else if (
                    current.status !== 'CANCELLED'
                    || current.consolidatedIntoOrderId !== consolidation.primaryOrderId
                    || toCents(current.total) !== 0
                ) {
                    throw new Error(`La orden absorbida #${current.id} ya no conserva el estado de consolidación`);
                }
            }

            const competingAccount = await tx.order.findFirst({
                where: {
                    companyId,
                    tableId: { in: tableIds },
                    id: { notIn: orderIds },
                    ...tableOpenAccountWhere()
                },
                select: { id: true, tableId: true, status: true, financialStatus: true }
            });
            if (competingAccount) {
                throw new Error(`La mesa #${competingAccount.tableId} ya tiene otra cuenta activa o entregada pendiente (#${competingAccount.id})`);
            }

            const itemIds = consolidation.itemSnapshots.map((snapshot) => snapshot.orderItemId);
            const currentItems = await tx.orderItem.findMany({
                where: { id: { in: itemIds } },
                include: {
                    modifiers: {
                        select: { id: true, modifierId: true, name: true, price: true },
                        orderBy: { id: 'asc' }
                    }
                }
            });
            const primaryItemCount = await tx.orderItem.count({
                where: { orderId: consolidation.primaryOrderId }
            });
            if (currentItems.length !== itemIds.length || primaryItemCount !== itemIds.length) {
                throw new Error('Los productos de la cuenta cambiaron después de consolidarse');
            }
            const itemById = new Map(currentItems.map((item) => [item.id, item]));
            const sourceTableByOrderId = new Map(
                consolidation.orderSnapshots.map((snapshot) => [snapshot.orderId, snapshot.originalTableId])
            );
            for (const snapshot of consolidation.itemSnapshots) {
                const item = itemById.get(snapshot.orderItemId);
                const expectedOriginOrderId = snapshot.sourceOrderId === consolidation.primaryOrderId
                    ? snapshot.previousOriginOrderId
                    : snapshot.previousOriginOrderId ?? snapshot.sourceOrderId;
                const expectedOriginTableId = snapshot.sourceOrderId === consolidation.primaryOrderId
                    ? snapshot.previousOriginTableId
                    : snapshot.previousOriginTableId ?? sourceTableByOrderId.get(snapshot.sourceOrderId) ?? null;
                if (
                    !item
                    || item.orderId !== consolidation.primaryOrderId
                    || item.originOrderId !== expectedOriginOrderId
                    || item.originTableId !== expectedOriginTableId
                    || itemFingerprint(item) !== snapshot.itemFingerprint
                ) {
                    throw new Error(`El producto #${snapshot.orderItemId} cambió después de consolidarse`);
                }
            }

            for (const snapshot of consolidation.itemSnapshots) {
                if (snapshot.sourceOrderId === consolidation.primaryOrderId) continue;
                const moved = await tx.orderItem.updateMany({
                    where: { id: snapshot.orderItemId, orderId: consolidation.primaryOrderId },
                    data: {
                        orderId: snapshot.sourceOrderId,
                        originOrderId: snapshot.previousOriginOrderId,
                        originTableId: snapshot.previousOriginTableId
                    }
                });
                if (moved.count !== 1) throw new Error(`Conflicto al restaurar el producto #${snapshot.orderItemId}`);
            }

            for (const snapshot of consolidation.orderSnapshots) {
                await tx.order.update({
                    where: { id: snapshot.orderId },
                    data: {
                        tableId: snapshot.originalTableId,
                        status: snapshot.originalStatus,
                        financialStatus: snapshot.originalFinancialStatus,
                        total: snapshot.originalTotal,
                        discount: snapshot.originalDiscount,
                        tax: snapshot.originalTax,
                        tipAmount: snapshot.originalTipAmount,
                        channelCommission: snapshot.originalChannelCommission,
                        channelMarkup: snapshot.originalChannelMarkup,
                        consolidatedIntoOrderId: snapshot.originalConsolidatedIntoId,
                        cancelledById: snapshot.originalCancelledById,
                        cancelledAt: snapshot.originalCancelledAt,
                        closedAt: snapshot.originalClosedAt,
                        cancelReason: snapshot.originalCancelReason
                    }
                });
            }

            const claimed = await tx.tableConsolidation.updateMany({
                where: { id: consolidationId, companyId, status: 'ACTIVE', version: expectedVersion },
                data: {
                    status: 'REVERSED',
                    version: { increment: 1 },
                    reversedById: actorId,
                    reversedAt: new Date(),
                    reversalReason: reason,
                    reversalKey
                }
            });
            if (claimed.count !== 1) throw new Error('Conflicto de concurrencia al revertir la consolidación');

            for (const tableId of tableIds) await syncTableStatus(tx, companyId, tableId);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'TableConsolidation',
                    entityId: consolidationId,
                    action: 'TABLE_CONSOLIDATION_REVERSE',
                    userId: actorId,
                    details: {
                        primaryOrderId: consolidation.primaryOrderId,
                        restoredOrderIds: orderIds,
                        restoredItemIds: itemIds,
                        tableIds,
                        reversalKey,
                        reason,
                        fromVersion: expectedVersion,
                        toVersion: expectedVersion + 1
                    }
                }
            });

            const orders = await tx.order.findMany({
                where: { companyId, id: { in: orderIds } },
                include: { table: true, items: { include: { menuItem: true, modifiers: true } } },
                orderBy: { id: 'asc' }
            });
            return {
                idempotent: false,
                consolidationId,
                version: expectedVersion + 1,
                primaryOrderId: consolidation.primaryOrderId,
                affectedTableIds: tableIds,
                orders
            };
        });
    }

    static async transfer(
        companyId: number,
        actorId: number,
        data: {
            sourceTableId: number;
            destinationTableId: number;
            orderId: number;
            items?: TransferSlice[];
            reason?: string;
        }
    ) {
        const sourceTableId = assertPositiveInteger(data.sourceTableId, 'sourceTableId');
        const destinationTableId = assertPositiveInteger(data.destinationTableId, 'destinationTableId');
        const orderId = assertPositiveInteger(data.orderId, 'orderId');
        if (sourceTableId === destinationTableId) throw new Error('Seleccione una mesa destino diferente');

        return prisma.$transaction(async (tx) => {
            const tables = await lockTables(tx, companyId, [sourceTableId, destinationTableId]);
            const sourceTable = tables.find((table) => table.id === sourceTableId)!;
            const destination = tables.find((table) => table.id === destinationTableId)!;
            assertCompatiblePhysicalGroups(tables, 'cambiar el consumo de mesa');
            if (sourceTable.branchId !== destination.branchId) throw new Error('El traslado debe realizarse dentro de la misma sucursal');
            if (destination.status === 'OUT_OF_SERVICE') throw new Error('La mesa destino está fuera de servicio');
            if (destination.status === 'RESERVED') throw new Error('La mesa destino está reservada');

            await lockOrders(tx, companyId, [orderId]);
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: {
                    payments: { where: { status: 'ACTIVE' }, select: { id: true } },
                    items: { include: { modifiers: true } }
                }
            });
            if (!order || order.tableId !== sourceTableId) throw new Error('La orden no pertenece a la mesa origen');
            validateMutableOrder(order);

            const slices = data.items;
            if (!slices || slices.length === 0) {
                const moved = await tx.order.update({
                    where: { id: order.id },
                    data: { tableId: destinationTableId },
                    include: { table: true, items: { include: { menuItem: true, modifiers: true } } }
                });
                await syncTableStatus(tx, companyId, sourceTableId);
                await syncTableStatus(tx, companyId, destinationTableId);
                await tx.auditLog.create({
                    data: {
                        companyId, entityType: 'Order', entityId: order.id, action: 'TABLE_TRANSFER', userId: actorId,
                        details: { sourceTableId, destinationTableId, mode: 'FULL', reason: data.reason?.trim() || null }
                    }
                });
                return { sourceOrder: null, destinationOrder: moved, mode: 'FULL' as const };
            }

            if (order.discountCode) throw new Error('Retire la promoción antes de realizar un traslado parcial');
            const normalized = slices.map((slice) => ({
                orderItemId: assertPositiveInteger(slice.orderItemId, 'orderItemId'),
                quantity: assertPositiveInteger(slice.quantity, 'quantity')
            }));
            if (new Set(normalized.map((slice) => slice.orderItemId)).size !== normalized.length) {
                throw new Error('No repita productos en el traslado');
            }
            const itemById = new Map(order.items.map((item) => [item.id, item]));
            let movedSubtotalCents = 0;
            for (const slice of normalized) {
                const item = itemById.get(slice.orderItemId);
                if (!item) throw new Error(`El producto #${slice.orderItemId} no pertenece a la orden`);
                if (slice.quantity > item.quantity) throw new Error(`La cantidad del producto #${slice.orderItemId} excede lo ordenado`);
                movedSubtotalCents += toCents(item.price) * slice.quantity;
            }
            const sourceSubtotalCents = sumCents(order.items.map((item) => item.subtotal));
            if (sourceSubtotalCents <= 0 || movedSubtotalCents <= 0) throw new Error('El traslado parcial debe tener un importe positivo');

            const destinationOrders = await tx.order.findMany({
                where: { companyId, tableId: destinationTableId, ...tableOpenAccountWhere() },
                include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
            });
            if (destinationOrders.length > 1) throw new Error('Consolide primero las órdenes activas de la mesa destino');
            await lockOrders(tx, companyId, destinationOrders.map((entry) => entry.id));
            const existingDestination = destinationOrders[0];
            if (existingDestination) {
                validateMutableOrder(existingDestination);
                if (existingDestination.discountCode) throw new Error('La orden destino tiene una promoción y no admite traslado parcial');
            }

            const destinationOrder = existingDestination ?? await tx.order.create({
                data: {
                    companyId,
                    branchId: order.branchId,
                    tableId: destinationTableId,
                    userId: order.userId,
                    customerName: order.customerName,
                    orderType: order.orderType,
                    salesChannel: order.salesChannel,
                    status: order.status,
                    financialStatus: 'UNPAID',
                    total: 0
                }
            });

            const movedItemIds: number[] = [];
            for (const slice of normalized) {
                const item = itemById.get(slice.orderItemId)!;
                if (slice.quantity === item.quantity) {
                    await tx.orderItem.update({
                        where: { id: item.id },
                        data: {
                            orderId: destinationOrder.id,
                            originOrderId: item.originOrderId ?? order.id,
                            originTableId: item.originTableId ?? sourceTableId
                        }
                    });
                    movedItemIds.push(item.id);
                } else {
                    const created = await tx.orderItem.create({
                        data: {
                            orderId: destinationOrder.id,
                            menuItemId: item.menuItemId,
                            quantity: slice.quantity,
                            price: item.price,
                            subtotal: fromCents(toCents(item.price) * slice.quantity),
                            notes: item.notes,
                            status: item.status,
                            sentAt: item.sentAt,
                            startedAt: item.startedAt,
                            finishedAt: item.finishedAt,
                            originOrderId: item.originOrderId ?? order.id,
                            originTableId: item.originTableId ?? sourceTableId,
                            modifiers: {
                                create: item.modifiers.map((modifier) => ({
                                    modifierId: modifier.modifierId,
                                    name: modifier.name,
                                    price: modifier.price
                                }))
                            }
                        }
                    });
                    movedItemIds.push(created.id);
                    await tx.orderItem.update({
                        where: { id: item.id },
                        data: {
                            quantity: { decrement: slice.quantity },
                            subtotal: fromCents(toCents(item.price) * (item.quantity - slice.quantity))
                        }
                    });
                }
            }

            const allocation = allocatePartialFinancials({
                originalTotalCents: toCents(order.total),
                sourceSubtotalCents,
                movedSubtotalCents,
                discountCents: toCents(order.discount),
                taxCents: toCents(order.tax),
                tipCents: toCents(order.tipAmount)
            });
            const { ratio, movedTotalCents, sourceTotalCents } = allocation;
            const movedDiscount = allocation.movedDiscountCents;
            const movedTax = allocation.movedTaxCents;
            const movedTip = allocation.movedTipCents;
            const movedCommission = Math.round(toCents(order.channelCommission) * ratio);
            const movedMarkup = Math.round(toCents(order.channelMarkup) * ratio);
            const remainingItems = await tx.orderItem.count({ where: { orderId: order.id } });

            const sourceOrder = await tx.order.update({
                where: { id: order.id },
                data: {
                    total: fromCents(sourceTotalCents),
                    discount: fromCents(toCents(order.discount) - movedDiscount),
                    tax: fromCents(toCents(order.tax) - movedTax),
                    tipAmount: fromCents(toCents(order.tipAmount) - movedTip),
                    channelCommission: fromCents(toCents(order.channelCommission) - movedCommission),
                    channelMarkup: fromCents(toCents(order.channelMarkup) - movedMarkup),
                    ...(remainingItems === 0 ? {
                        status: 'CANCELLED' as const,
                        consolidatedIntoOrderId: destinationOrder.id,
                        cancelledById: actorId,
                        cancelledAt: new Date(),
                        closedAt: new Date(),
                        cancelReason: `Traslado parcial completado a mesa #${destinationTableId}`
                    } : {})
                }
            });

            const targetStatus = workflowStatus([
                destinationOrder.status as ActiveStatus,
                order.status as ActiveStatus
            ]);
            const updatedDestination = await tx.order.update({
                where: { id: destinationOrder.id },
                data: {
                    status: targetStatus,
                    total: fromCents(toCents(destinationOrder.total) + movedTotalCents),
                    discount: fromCents(toCents(destinationOrder.discount) + movedDiscount),
                    tax: fromCents(toCents(destinationOrder.tax) + movedTax),
                    tipAmount: fromCents(toCents(destinationOrder.tipAmount) + movedTip),
                    channelCommission: fromCents(toCents(destinationOrder.channelCommission) + movedCommission),
                    channelMarkup: fromCents(toCents(destinationOrder.channelMarkup) + movedMarkup)
                },
                include: { table: true, items: { include: { menuItem: true, modifiers: true } } }
            });

            await syncTableStatus(tx, companyId, sourceTableId);
            await syncTableStatus(tx, companyId, destinationTableId);
            await tx.auditLog.create({
                data: {
                    companyId, entityType: 'Order', entityId: order.id, action: 'TABLE_TRANSFER', userId: actorId,
                    details: {
                        sourceTableId, destinationTableId, destinationOrderId: destinationOrder.id,
                        mode: 'PARTIAL', slices: normalized, movedItemIds,
                        allocationPolicy: 'proportional_by_item_subtotal_round_half_up_remainder_on_source',
                        reason: data.reason?.trim() || null
                    }
                }
            });
            return { sourceOrder, destinationOrder: updatedDestination, mode: 'PARTIAL' as const };
        });
    }
}
