import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

const ACTIVE_STATUSES = ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] as const;
type ActiveStatus = typeof ACTIVE_STATUSES[number];

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
    const active = await tx.order.count({
        where: { companyId, tableId, status: { in: [...ACTIVE_STATUSES] } }
    });
    const table = await tx.table.findUnique({ where: { id: tableId }, select: { status: true } });
    if (!table || table.status === 'OUT_OF_SERVICE' || table.status === 'RESERVED') return;
    await tx.table.update({
        where: { id: tableId },
        data: { status: active > 0 ? 'OCCUPIED' : 'AVAILABLE' }
    });
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
            if (destination.status === 'OUT_OF_SERVICE') throw new Error('La mesa destino está fuera de servicio');
            if (destination.status === 'RESERVED') throw new Error('La mesa destino está reservada');
            if (tables.some((table) => table.branchId !== destination.branchId)) {
                throw new Error('Solo se pueden consolidar mesas de la misma sucursal');
            }

            const orders = await tx.order.findMany({
                where: {
                    companyId,
                    tableId: { in: [destinationTableId, ...sourceTableIds] },
                    status: { in: [...ACTIVE_STATUSES] }
                },
                include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } }, items: { select: { id: true } } }
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
            const movedItemIds: number[] = [];

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
                await tx.order.update({
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
                        absorbedOrderIds: secondary.map((order) => order.id),
                        movedItemIds,
                        reason: data.reason?.trim() || null
                    }
                }
            });
            return updatedPrimary;
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
                where: { companyId, tableId: destinationTableId, status: { in: [...ACTIVE_STATUSES] } },
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
