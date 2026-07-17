import prisma from '../utils/prisma';
import type { CateringPaymentType, Prisma } from '@prisma/client';
import { CateringStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { getErrorMessage } from '../utils/error';
import { getZonedDayBounds, isValidTimeZone, zonedDateKey } from '../utils/timezone';
import { UnitConversionService } from './unit-conversion.service';
import { InventoryEngineService } from './inventory-engine.service';
import { DEFAULT_COMPANY_SETTINGS, SettingService } from './setting.service';

export interface CateringServiceLineDto {
    cateringServiceId: number | string;
    quantity: number | string;
    unitPrice: number | string;
    notes?: string | null;
}

export interface CateringMenuLineDto {
    menuItemId: number | string;
    quantity: number | string;
    unitPrice: number | string;
}

/** Request body shape for create/update catering events (from HTTP JSON) */
export interface CateringEventWriteBody {
    branchId?: unknown;
    warehouseId?: unknown;
    services?: CateringServiceLineDto[];
    menuItems?: CateringMenuLineDto[];
    customerName?: string;
    customerPhone?: string;
    customerTaxId?: string;
    customerId?: unknown;
    date?: unknown;
    title?: unknown;
    peopleCount?: unknown;
    status?: CateringStatus;
    location?: unknown;
    notes?: unknown;
    clauses?: unknown;
    companyId?: unknown;
}

export const CATERING_STATUS_TRANSITIONS: Record<CateringStatus, readonly CateringStatus[]> = {
    QUOTED: ['RESERVED', 'CANCELLED'],
    RESERVED: ['CANCELLED'],
    PAID: ['FINISHED'],
    FINISHED: [],
    CANCELLED: [],
};

function decomposeTaxInclusiveGross(gross: Decimal, settings: Record<string, string>) {
    const configured = Number.parseFloat(settings.tax_rate || settings.taxRate || '');
    const fallback = Number(DEFAULT_COMPANY_SETTINGS.tax_rate);
    const taxRatePercent = Number.isFinite(configured) ? configured : fallback;
    if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100) {
        throw new Error('La tasa fiscal de Catering no es válida');
    }
    const subtotal = gross.div(new Decimal(1).add(new Decimal(taxRatePercent).div(100))).toDecimalPlaces(2);
    return {
        fiscalSubtotal: subtotal,
        fiscalTax: gross.sub(subtotal).toDecimalPlaces(2),
        fiscalTaxRatePercent: new Decimal(taxRatePercent),
        pricingSnapshotCapturedAt: new Date()
    };
}

export class CateringService {
    private static async convertRecipeQuantityToBase(
        recipe: { productId: number; quantity: Decimal | number | string; unit?: string | null; product: { unit: string } },
        companyId: number,
        tx?: Prisma.TransactionClient
    ) {
        const recipeUnit = recipe.unit || recipe.product.unit;
        const recipeQty = Number(recipe.quantity);
        const conv = await UnitConversionService.convert(
            recipe.productId, companyId, recipeQty, recipeUnit, tx
        );
        return {
            baseQuantity: conv.baseQuantity,
            originalQuantity: conv.originalQuantity,
            originalUnit: conv.originalUnit,
            conversionFactor: conv.conversionFactor,
            recipeUnit
        };
    }

    static async getAllEvents(companyId: number, filters?: {
        branchId?: number;
        status?: CateringStatus;
        startDate?: Date;
        endDate?: Date;
    }) {
        const where: Prisma.CateringEventWhereInput = { companyId };

        if (filters?.branchId) where.branchId = filters.branchId;
        if (filters?.status) where.status = filters.status;
        if (filters?.startDate || filters?.endDate) {
            where.date = {};
            if (filters.startDate) where.date.gte = filters.startDate;
            if (filters.endDate) where.date.lte = filters.endDate;
        }

        return await prisma.cateringEvent.findMany({
            where,
            include: {
                branch: { select: { id: true, name: true } },
                customer: true,
                services: {
                    include: { service: true }
                },
                menuItems: {
                    include: { menuItem: true }
                },
                _count: {
                    select: { services: true, menuItems: true, payments: true }
                }
            },
            orderBy: { date: 'asc' }
        });
    }

    static async getEventById(id: number, companyId: number) {
        const event = await prisma.cateringEvent.findFirst({
            where: { id, companyId },
            include: {
                branch: true,
                customer: true,
                services: {
                    include: { service: true }
                },
                menuItems: {
                    include: { menuItem: true }
                },
                payments: {
                    include: { paymentMethod: true }
                },
                fiscalInvoice: { select: { number: true, status: true, issuedAt: true } },
                fiscalCreditNote: { select: { number: true, status: true, issuedAt: true, reason: true } }
            }
        });

        if (!event) throw new Error('Catering event not found');
        return event;
    }

    // Validate that all client-provided foreign keys belong to the caller's
    // company before persisting (Prisma only checks FKs by global id).
    private static async assertEventRefs(companyId: number, refs: {
        branchId?: number;
        customerId?: number;
        serviceIds?: number[];
        menuItemIds?: number[];
    }) {
        if (refs.branchId !== undefined) {
            const b = await prisma.branch.findFirst({ where: { id: refs.branchId, companyId }, select: { id: true } });
            if (!b) throw new Error('Sucursal no encontrada para esta empresa');
        }
        if (refs.customerId !== undefined) {
            const c = await prisma.customer.findFirst({ where: { id: refs.customerId, companyId }, select: { id: true } });
            if (!c) throw new Error('Cliente no encontrado para esta empresa');
        }
        const serviceIds = [...new Set((refs.serviceIds || []).filter((n) => Number.isFinite(n)))];
        if (serviceIds.length) {
            const found = await prisma.cateringService.findMany({ where: { id: { in: serviceIds }, companyId, active: true }, select: { id: true } });
            if (found.length !== serviceIds.length) throw new Error('Uno o más servicios no pertenecen a esta empresa');
        }
        const menuIds = [...new Set((refs.menuItemIds || []).filter((n) => Number.isFinite(n)))];
        if (menuIds.length) {
            const found = await prisma.menuItem.findMany({
                where: {
                    id: { in: menuIds },
                    companyId,
                    active: true,
                    ...(refs.branchId !== undefined ? { OR: [{ branchId: null }, { branchId: refs.branchId }] } : {})
                },
                select: { id: true }
            });
            if (found.length !== menuIds.length) throw new Error('Uno o más ítems de menú no pertenecen a esta empresa');
        }
    }

    static async createEvent(companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, ...eventData } = data;
        const normalizedCustomerName = customerName?.trim();
        const normalizedTitle = typeof eventData.title === 'string' ? eventData.title.trim() : '';
        const eventDate = new Date(eventData.date as string | number | Date);
        const peopleCount = Number(eventData.peopleCount);
        if (!normalizedCustomerName) throw new Error('El nombre del cliente es requerido');
        if (!normalizedTitle) throw new Error('El título del evento es requerido');
        if (Number.isNaN(eventDate.getTime()) || eventDate < new Date()) throw new Error('La fecha del evento debe ser futura');
        if (!Number.isInteger(peopleCount) || peopleCount < 1) throw new Error('La cantidad de personas debe ser un entero mayor a 0');
        if (data.status !== undefined && data.status !== 'QUOTED') {
            throw new Error('Los eventos nuevos deben iniciar en estado COTIZADO');
        }
        eventData.status = 'QUOTED';

        // Ensure branchId is an Int
        const branchId = parseInt(String(eventData.branchId), 10);
        if (isNaN(branchId)) throw new Error('Valid branchId is required');

        // Validate the branch belongs to this tenant before creating the event.
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId }
        });
        if (!branch || branch.status !== 'ACTIVE') throw new Error('Sucursal no encontrada o inactiva para esta empresa');

        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;
        let createCustomer = false;

        // If no customerId but name is provided, find or create
        if (!customerId && normalizedCustomerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: normalizedCustomerName, companyId }
            });

            if (customer) {
                customerId = customer.id;
            } else {
                createCustomer = true;
            }
        }

        // Calculate initial total
        let totalAmount = new Decimal(0);

        // Services total
        const servicesToCreate = services?.map((s) => {
            const cateringServiceId = parseInt(String(s.cateringServiceId), 10);
            if (!Number.isInteger(cateringServiceId) || cateringServiceId <= 0) throw new Error('Servicio de catering inválido');
            const quantity = Number(s.quantity);
            const unitPrice = Number(s.unitPrice);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad del servicio debe ser mayor a 0');
            if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio del servicio no puede ser negativo');
            const subtotal = new Decimal(s.quantity).mul(new Decimal(s.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                cateringServiceId,
                quantity: new Decimal(s.quantity),
                unitPrice: new Decimal(s.unitPrice),
                subtotal,
                notes: s.notes
            };
        }) || [];

        // Menu items total
        const menuItemsToCreate = menuItems?.map((m) => {
            const menuItemId = parseInt(String(m.menuItemId), 10);
            if (!Number.isInteger(menuItemId) || menuItemId <= 0) throw new Error('Plato de menú inválido');
            const quantity = Number(m.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('La cantidad de platos del menú debe ser un entero mayor a 0');
            }
            if (!Number.isFinite(Number(m.unitPrice)) || Number(m.unitPrice) < 0) {
                throw new Error('El precio del plato no puede ser negativo');
            }
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId,
                quantity,
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        // Ensure customer / services / menu items all belong to this company.
        await this.assertEventRefs(companyId, {
            branchId,
            customerId,
            serviceIds: servicesToCreate.map((s) => s.cateringServiceId),
            menuItemIds: menuItemsToCreate.map((m) => m.menuItemId),
        });

        const cleanEventData: Record<string, unknown> = {
            title: normalizedTitle,
            peopleCount,
            status: 'QUOTED',
            location: eventData.location,
            notes: eventData.notes,
            clauses: eventData.clauses
        };

        const fiscalPricing = decomposeTaxInclusiveGross(totalAmount, await SettingService.getAll(companyId));

        try {
            // Create the event and (if it starts FINISHED) deduct inventory in the
            // SAME transaction so a deduction failure rolls back the event.
            const event = await prisma.$transaction(async (tx) => {
                if (createCustomer && normalizedCustomerName) {
                    const customer = await tx.customer.create({ data: { name: normalizedCustomerName, phone: customerPhone, taxId: customerTaxId, companyId } });
                    customerId = customer.id;
                } else if (customerId && (customerPhone || customerTaxId)) {
                    await tx.customer.updateMany({ where: { id: customerId, companyId }, data: { phone: customerPhone, taxId: customerTaxId } });
                }
                const created = await tx.cateringEvent.create({
                    data: {
                        ...cleanEventData,
                        branch: { connect: { id: branchId } },
                        company: { connect: { id: companyId } },
                        customer: customerId ? { connect: { id: customerId } } : undefined,
                        totalAmount,
                        balance: totalAmount,
                        ...fiscalPricing,
                        services: { create: servicesToCreate },
                        menuItems: { create: menuItemsToCreate },
                        date: eventDate
                    } as Prisma.CateringEventCreateInput,
                    include: {
                        customer: true,
                        services: true,
                        menuItems: true
                    }
                });

                await tx.auditLog.create({
                    data: {
                        companyId,
                        userId,
                        entityType: 'CateringEvent',
                        entityId: created.id,
                        action: 'CREATE',
                        details: {
                            branchId,
                            totalAmount: Number(totalAmount),
                            serviceLines: servicesToCreate.length,
                            menuLines: menuItemsToCreate.length
                        }
                    }
                });

                return created;
            });

            return event;
        } catch (error: unknown) {
            console.error('Error creating catering event:', error);
            throw new Error(`Failed to create catering event: ${getErrorMessage(error)}`);
        }
    }

    static async updateEvent(id: number, companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, warehouseId: warehouseIdInput, ...eventData } = data;
        const normalizedCustomerName = customerName === undefined ? undefined : customerName.trim();
        const normalizedTitle = eventData.title === undefined ? undefined : String(eventData.title).trim();
        if (normalizedCustomerName !== undefined && !normalizedCustomerName) throw new Error('El nombre del cliente es requerido');
        if (normalizedTitle !== undefined && !normalizedTitle) throw new Error('El título del evento es requerido');
        if (eventData.peopleCount !== undefined) {
            const peopleCount = Number(eventData.peopleCount);
            if (!Number.isInteger(peopleCount) || peopleCount < 1) throw new Error('La cantidad de personas debe ser un entero mayor a 0');
            eventData.peopleCount = peopleCount;
        }
        if (eventData.date !== undefined) {
            const requestedDate = new Date(eventData.date as string | number | Date);
            if (Number.isNaN(requestedDate.getTime())) throw new Error('La fecha del evento no es válida');
            eventData.date = requestedDate;
        }
        if (normalizedTitle !== undefined) eventData.title = normalizedTitle;

        // Tenant-scoped load: never operate on another company's event.
        const oldEvent = await prisma.cateringEvent.findFirst({
            where: { id, companyId },
            select: {
                status: true,
                date: true,
                branchId: true,
                customerId: true,
                services: { select: { subtotal: true } },
                menuItems: { select: { subtotal: true, menuItemId: true } },
                payments: { select: { status: true } },
                fiscalSubtotal: true,
                fiscalTax: true,
                fiscalTaxRatePercent: true,
                pricingSnapshotCapturedAt: true
            }
        });

        if (!oldEvent) throw new Error('Catering event not found');
        if (
            eventData.date instanceof Date
            && eventData.date < new Date()
            && eventData.date.getTime() !== oldEvent.date.getTime()
        ) {
            throw new Error('La fecha del evento debe ser futura');
        }
        if (oldEvent.status === 'FINISHED' || oldEvent.status === 'CANCELLED') {
            throw new Error('Los eventos finalizados o cancelados son inmutables');
        }
        if (oldEvent.status === 'PAID') {
            const keys = Object.keys(data).filter((key) => data[key as keyof CateringEventWriteBody] !== undefined);
            if (data.status !== 'FINISHED' || keys.some((key) => key !== 'status' && key !== 'warehouseId')) {
                throw new Error('Un evento pagado solo puede marcarse como finalizado');
            }
        }
        // Fast fail before resolving foreign keys or mutable fiscal settings.
        // The transaction repeats this check under lock to close the race where
        // a payment is posted immediately after this snapshot.
        if (
            (services !== undefined || menuItems !== undefined)
            && oldEvent.payments.some((payment) => payment.status === 'ACTIVE')
        ) {
            throw new Error('No se pueden modificar conceptos o totales de un evento con pagos activos; revierta los pagos primero');
        }

        // Validate status transition if status is changing
        if (data.status && oldEvent && data.status !== oldEvent.status) {
            const validNext = CATERING_STATUS_TRANSITIONS[oldEvent.status] || [];
            if (!validNext.includes(data.status)) {
                throw new Error(`Transición de estado inválida: ${oldEvent.status} → ${data.status}`);
            }
        }
        if (data.status === 'CANCELLED' && oldEvent.payments.some((payment) => payment.status === 'ACTIVE')) {
            throw new Error('No se puede cancelar un evento con pagos registrados; revierta los pagos primero');
        }

        // Optional conversions
        const branchId =
            eventData.branchId != null && eventData.branchId !== ''
                ? parseInt(String(eventData.branchId), 10)
                : undefined;
        const effectiveBranchId = branchId ?? oldEvent.branchId;
        const warehouseId = warehouseIdInput != null && warehouseIdInput !== ''
            ? Number(warehouseIdInput)
            : undefined;
        if (data.status === 'FINISHED' && (!Number.isInteger(warehouseId) || Number(warehouseId) <= 0)) {
            throw new Error('Seleccione una bodega de la sucursal para finalizar el evento');
        }
        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;
        let createCustomer = false;

        // If no customerId but name is provided, find or create
        if (!customerId && normalizedCustomerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: normalizedCustomerName, companyId }
            });

            if (customer) {
                customerId = customer.id;
                createCustomer = false;
            } else {
                createCustomer = true;
            }
        }

        // Recalculate totals
        let totalAmount = new Decimal(0);
        if (services === undefined) {
            totalAmount = oldEvent.services.reduce((sum, line) => sum.add(new Decimal(line.subtotal)), totalAmount);
        }
        if (menuItems === undefined) {
            totalAmount = oldEvent.menuItems.reduce((sum, line) => sum.add(new Decimal(line.subtotal)), totalAmount);
        }
        const servicesToUpdate = services?.map((s) => {
            const cateringServiceId = parseInt(String(s.cateringServiceId), 10);
            if (!Number.isInteger(cateringServiceId) || cateringServiceId <= 0) throw new Error('Servicio de catering inválido');
            const quantity = Number(s.quantity);
            const unitPrice = Number(s.unitPrice);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad del servicio debe ser mayor a 0');
            if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio del servicio no puede ser negativo');
            const subtotal = new Decimal(s.quantity).mul(new Decimal(s.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                cateringServiceId,
                quantity: new Decimal(s.quantity),
                unitPrice: new Decimal(s.unitPrice),
                subtotal,
                notes: s.notes
            };
        }) || [];

        const menuItemsToUpdate = menuItems?.map((m) => {
            const menuItemId = parseInt(String(m.menuItemId), 10);
            if (!Number.isInteger(menuItemId) || menuItemId <= 0) throw new Error('Plato de menú inválido');
            const quantity = Number(m.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('La cantidad de platos del menú debe ser un entero mayor a 0');
            }
            if (!Number.isFinite(Number(m.unitPrice)) || Number(m.unitPrice) < 0) throw new Error('El precio del plato no puede ser negativo');
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId,
                quantity,
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        // Ensure branch / customer / services / menu items belong to this company.
        await this.assertEventRefs(companyId, {
            branchId: effectiveBranchId,
            customerId,
            serviceIds: servicesToUpdate.map((s) => s.cateringServiceId),
            menuItemIds: menuItems === undefined
                ? oldEvent.menuItems.map((m) => m.menuItemId)
                : menuItemsToUpdate.map((m) => m.menuItemId),
        });

        const { date } = eventData;
        const cleanEventData: Record<string, unknown> = {};
        for (const field of ['title', 'peopleCount', 'status', 'location', 'notes', 'clauses'] as const) {
            if (eventData[field] !== undefined) cleanEventData[field] = eventData[field];
        }
        const fiscalPricing = services !== undefined || menuItems !== undefined
            ? decomposeTaxInclusiveGross(totalAmount, await SettingService.getAll(companyId))
            : null;

        try {
            const updatedEvent = await prisma.$transaction(async (tx) => {
                if (createCustomer && normalizedCustomerName) {
                    const customer = await tx.customer.create({ data: { name: normalizedCustomerName, phone: customerPhone, taxId: customerTaxId, companyId } });
                    customerId = customer.id;
                } else if (customerId && (normalizedCustomerName || customerPhone || customerTaxId)) {
                    await tx.customer.updateMany({ where: { id: customerId, companyId }, data: { name: normalizedCustomerName, phone: customerPhone, taxId: customerTaxId } });
                }
                await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
                const locked = await tx.cateringEvent.findFirst({
                    where: { id, companyId },
                    select: { status: true, payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
                });
                if (!locked) throw new Error('Catering event not found');
                if (locked.status !== oldEvent.status) throw new Error('El evento cambió de estado; recargue e intente nuevamente');
                if (data.status === 'CANCELLED' && locked.payments.length > 0) throw new Error('No se puede cancelar un evento con pagos activos; revierta los pagos primero');
                if (locked.payments.length > 0 && branchId !== undefined && branchId !== oldEvent.branchId) {
                    throw new Error('No se puede cambiar la sucursal de un evento con pagos activos; revierta los pagos primero');
                }
                if ((services !== undefined || menuItems !== undefined) && locked.payments.length > 0) {
                    throw new Error('No se pueden modificar conceptos o totales de un evento con pagos activos; revierta los pagos primero');
                }
                if (services !== undefined) await tx.cateringServiceItem.deleteMany({ where: { cateringEventId: id } });
                if (menuItems !== undefined) await tx.cateringMenuItem.deleteMany({ where: { cateringEventId: id } });

                const updateData = {
                    ...cleanEventData,
                    totalAmount,
                    ...(fiscalPricing || {}),
                    updatedAt: new Date()
                } as Prisma.CateringEventUpdateInput;

                if (services !== undefined) updateData.services = { create: servicesToUpdate };
                if (menuItems !== undefined) updateData.menuItems = { create: menuItemsToUpdate };

                if (branchId) updateData.branch = { connect: { id: branchId } };
                if (customerId) updateData.customer = { connect: { id: customerId } };
                if (date != null) updateData.date = new Date(date as string | number | Date);

                const event = await tx.cateringEvent.update({
                    where: { id },
                    data: updateData,
                    include: { payments: true }
                });

                // Recalculate balance inside transaction
                const paid = event.payments
                    .filter((payment) => payment.status === 'ACTIVE')
                    .reduce((sum, payment) => sum.add(new Decimal(payment.amount)), new Decimal(0));
                const newBalance = totalAmount.sub(paid);

                const finalEvent = await tx.cateringEvent.update({
                    where: { id },
                    data: { balance: newBalance }
                });

                // Trigger inventory deduction inside transaction if status changed to FINISHED
                if (oldEvent?.status !== 'FINISHED' && data.status === 'FINISHED') {
                    await this.deductInventoryTx(tx, id, companyId, userId, warehouseId!);
                }

                await tx.auditLog.create({
                    data: {
                        companyId,
                        userId,
                        entityType: 'CateringEvent',
                        entityId: id,
                        action: data.status && data.status !== oldEvent.status ? 'STATUS_CHANGE' : 'UPDATE',
                        details: {
                            previousStatus: oldEvent.status,
                            nextStatus: data.status ?? oldEvent.status,
                            fields: Object.keys(data).filter((key) => data[key as keyof CateringEventWriteBody] !== undefined),
                            warehouseId: data.status === 'FINISHED' ? warehouseId : null
                        }
                    }
                });

                return finalEvent;
            });

            return updatedEvent;
        } catch (error: unknown) {
            console.error('Error updating catering event:', error);
            throw new Error(`Failed to update catering event: ${getErrorMessage(error)}`);
        }
    }

    private static async deductInventoryTx(
        tx: Prisma.TransactionClient,
        eventId: number,
        companyId: number,
        userId: number,
        warehouseId: number
    ) {
        const event = await tx.cateringEvent.findUnique({
            where: { id: eventId },
            include: {
                branch: true,
                menuItems: {
                    include: {
                        menuItem: {
                            include: {
                                recipes: {
                                    include: { product: true }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!event) {
            throw new Error('Evento de catering no encontrado para descontar inventario');
        }

        // IDEMPOTENCY GUARD: skip when this event's stock is already deducted.
        // Mirrors order consumption: net = OUT - reversal IN for the stable ref.
        const reference = `EVT-${event.id}`;
        const priorMovements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { warehouseId: true, productId: true, type: true, quantity: true }
        });
        const netByStock = new Map<string, number>();
        for (const movement of priorMovements) {
            const key = `${movement.warehouseId}|${movement.productId}`;
            const quantity = Number(movement.quantity);
            netByStock.set(key, (netByStock.get(key) ?? 0) + (movement.type === 'OUT' ? quantity : -quantity));
        }
        if ([...netByStock.values()].some((quantity) => quantity > 1e-9)) return;

        await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} FOR UPDATE`;
        const warehouse = await tx.warehouse.findFirst({
            where: { id: warehouseId, branchId: event.branchId, companyId, type: 'BRANCH' }
        });

        if (!warehouse) throw new Error('No se encontró almacén para la deducción de inventario');

        const productIds = [...new Set(event.menuItems.flatMap((line) =>
            line.menuItem.recipes.map((recipe) => recipe.productId)
        ))].sort((a, b) => a - b);
        for (const productId of productIds) {
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        }

        for (const cMenuItem of event.menuItems) {
            for (const recipe of cMenuItem.menuItem.recipes) {
                const conv = await this.convertRecipeQuantityToBase(recipe, companyId, tx);
                const totalNeeded = conv.baseQuantity * cMenuItem.quantity;

                // Stock lock, availability check, costing, FIFO-layer consumption
                // and the OUT movement are handled by the single inventory engine.
                await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId,
                    productId: recipe.productId,
                    userId,
                    quantity: totalNeeded,
                    originalQuantity: conv.originalQuantity ? conv.originalQuantity * cMenuItem.quantity : null,
                    originalUnit: conv.originalUnit,
                    conversionFactor: conv.conversionFactor,
                    reason: `Catering Event: ${event.title}`,
                    reference,
                    productName: recipe.product.name
                });
            }
        }
    }

    static async deleteEvent(id: number, companyId: number, userId: number) {
        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const event = await tx.cateringEvent.findFirst({
                where: { id, companyId },
                select: { status: true, payments: { select: { id: true } } }
            });
            if (!event) throw new Error('Catering event not found');
            if (event.status !== 'QUOTED' && event.status !== 'CANCELLED') {
                throw new Error('Solo se pueden eliminar eventos en estado COTIZADO o CANCELADO');
            }
            if (event.payments.length > 0) {
                throw new Error('No se puede eliminar un evento con pagos registrados');
            }
            await tx.cateringServiceItem.deleteMany({ where: { cateringEventId: id } });
            await tx.cateringMenuItem.deleteMany({ where: { cateringEventId: id } });
            const deleted = await tx.cateringEvent.delete({ where: { id } });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId,
                    entityType: 'CateringEvent',
                    entityId: id,
                    action: 'DELETE',
                    details: { previousStatus: event.status }
                }
            });
            return deleted;
        });
    }

    static async addPayment(
        eventId: number,
        companyId: number,
        userId: number,
        paymentData: {
            amount: number | string | Decimal;
            paymentMethodId: number;
            type?: CateringPaymentType;
            reference?: string | null;
            idempotencyKey?: string | null;
        }
    ) {
        const rawAmount = Number(paymentData.amount);
        if (!Number.isFinite(rawAmount)) {
            throw new Error('El monto debe ser un numero finito');
        }
        const amountCents = Math.round(rawAmount * 100);
        if (Math.abs(rawAmount - amountCents / 100) > 1e-9) {
            throw new Error('El monto debe tener como máximo dos decimales');
        }
        const amount = amountCents / 100;
        if (amountCents <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        if (!Number.isInteger(paymentData.paymentMethodId) || paymentData.paymentMethodId <= 0) {
            throw new Error('Método de pago inválido');
        }
        const idempotencyKey = paymentData.idempotencyKey?.trim() || null;
        if (idempotencyKey && idempotencyKey.length > 191) {
            throw new Error('Clave de idempotencia demasiado larga');
        }

        return await prisma.$transaction(async (tx) => {
            // Pessimistic lock: serialize concurrent payments on the same event
            // so the balance check and update cannot race.
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${eventId} AND companyId = ${companyId} FOR UPDATE`;

            const event = await tx.cateringEvent.findFirst({
                where: { id: eventId, companyId },
                include: {
                    payments: {
                        include: { paymentMethod: { select: { type: true } } }
                    },
                    fiscalInvoice: { select: { status: true } }
                }
            });

            if (!event) {
                throw new Error('Catering event not found');
            }
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario no válido para esta empresa');

            if (idempotencyKey) {
                const existingPayment = event.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
                if (existingPayment) {
                    if (existingPayment.status === 'REVERSED') {
                        throw new Error('La clave de idempotencia pertenece a un pago revertido y no puede reutilizarse');
                    }
                    const sameRequest = Math.round(Number(existingPayment.amount) * 100) === amountCents
                        && existingPayment.paymentMethodId === paymentData.paymentMethodId
                        && existingPayment.type === (paymentData.type || 'ADVANCE')
                        && (existingPayment.reference || null) === (paymentData.reference?.trim() || null);
                    if (!sameRequest) throw new Error('Clave de idempotencia reutilizada con datos de pago diferentes');
                    if (existingPayment.methodType === 'CASH') {
                        await this.assertCashPaymentLedger(tx, {
                            paymentId: existingPayment.id,
                            amount: existingPayment.amount,
                            companyId,
                            branchId: event.branchId,
                            expectCompensation: false
                        });
                    }
                    return existingPayment;
                }
            }

            const reference = paymentData.reference?.trim();
            if (reference) {
                const existingPayment = event.payments.find((payment) => payment.reference === reference);
                if (existingPayment) {
                    if (existingPayment.status === 'REVERSED') {
                        throw new Error('La referencia pertenece a un pago revertido y no puede reutilizarse');
                    }
                    const sameRequest = Number(existingPayment.amount) === amount
                        && existingPayment.paymentMethodId === paymentData.paymentMethodId
                        && existingPayment.type === (paymentData.type || 'ADVANCE');
                    if (!sameRequest) throw new Error('La referencia de pago ya fue usada con datos diferentes');
                    if (existingPayment.methodType === 'CASH') {
                        await this.assertCashPaymentLedger(tx, {
                            paymentId: existingPayment.id,
                            amount: existingPayment.amount,
                            companyId,
                            branchId: event.branchId,
                            expectCompensation: false
                        });
                    }
                    return existingPayment;
                }
            }

            if (event.status === 'CANCELLED') {
                throw new Error('No se pueden agregar pagos a eventos cancelados');
            }
            if (event.status !== 'RESERVED') {
                throw new Error('Solo se pueden registrar pagos en eventos reservados');
            }

            // Payment method must be global (companyId null) or belong to this company.
            await tx.$queryRaw`SELECT id FROM \`PaymentMethod\` WHERE id = ${paymentData.paymentMethodId} FOR UPDATE`;
            const method = await tx.paymentMethod.findFirst({
                where: {
                    id: paymentData.paymentMethodId,
                    active: true,
                    OR: [{ companyId }, { companyId: null }]
                },
                select: { id: true, type: true }
            });
            if (!method) throw new Error('Método de pago inactivo o no válido para esta empresa');

            // Recompute balance from the authoritative total minus paid amounts
            // INSIDE the locked transaction (do not trust the stored balance).
            const paid = event.payments
                .filter((payment) => payment.status === 'ACTIVE')
                .reduce((sum, payment) => sum.add(new Decimal(payment.amount)), new Decimal(0));
            const currentBalance = new Decimal(event.totalAmount).sub(paid);
            const currentBalanceCents = Math.round(Number(currentBalance) * 100);

            if (amountCents > currentBalanceCents) {
                throw new Error(`El monto excede el saldo pendiente de ${Number(currentBalance).toFixed(2)}`);
            }

            let cashShiftId: number | null = null;
            if (method.type === 'CASH') {
                cashShiftId = await this.lockActorCashShift(tx, {
                    companyId,
                    branchId: event.branchId,
                    userId,
                    action: 'cobro'
                });
            }

            const payment = await tx.cateringPayment.create({
                data: {
                    amount,
                    paymentMethodId: paymentData.paymentMethodId,
                    methodType: method.type,
                    type: paymentData.type || 'ADVANCE',
                    reference: reference || null,
                    idempotencyKey,
                    registeredById: userId,
                    cateringEventId: eventId
                }
            });

            if (cashShiftId !== null) {
                await tx.cashMovement.create({
                    data: {
                        shiftId: cashShiftId,
                        type: 'IN',
                        amount,
                        description: `Pago Catering #${eventId}`,
                        reference: `CAT-PAY-${payment.id}`
                    }
                });
            }

            const newBalance = currentBalance.sub(new Decimal(amount));
            await tx.cateringEvent.update({
                where: { id: eventId },
                data: {
                    balance: newBalance,
                    status: newBalance.lte(0) ? 'PAID' : event.status
                }
            });

            await tx.auditLog.create({
                data: {
                    companyId,
                    userId,
                    entityType: 'CateringPayment',
                    entityId: payment.id,
                    action: 'CREATE',
                    details: { eventId, amount, paymentMethodId: method.id, paymentMethodType: method.type }
                }
            });

            return payment;
        });
    }

    static async reversePayment(
        eventId: number,
        paymentId: number,
        companyId: number,
        userId: number,
        reason: string
    ) {
        const reversalReason = reason?.trim();
        if (!reversalReason || reversalReason.length < 3) {
            throw new Error('Debe indicar un motivo de reverso');
        }

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${eventId} AND companyId = ${companyId} FOR UPDATE`;
            const event = await tx.cateringEvent.findFirst({
                where: { id: eventId, companyId },
                include: {
                    payments: {
                        include: { paymentMethod: { select: { type: true } } }
                    },
                    fiscalInvoice: { select: { status: true } }
                }
            });

            if (!event) throw new Error('Catering event not found');
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            if (event.fiscalInvoice) {
                throw new Error('Una factura fiscal emitida solo puede revertirse mediante nota de crédito total');
            }
            if (event.status === 'FINISHED') {
                throw new Error('No se puede revertir un pago de un evento finalizado');
            }

            const payment = event.payments.find((candidate) => candidate.id === paymentId);
            if (!payment) throw new Error('Pago de catering no encontrado');

            if (payment.methodType === 'CASH') {
                await this.assertCashPaymentLedger(tx, {
                    paymentId: payment.id,
                    amount: payment.amount,
                    companyId,
                    branchId: event.branchId,
                    expectCompensation: payment.status === 'REVERSED'
                });
            }
            if (payment.status === 'REVERSED') return payment;

            if (payment.methodType === 'CASH') {
                const refundShiftId = await this.lockActorCashShift(tx, {
                    companyId,
                    branchId: event.branchId,
                    userId,
                    action: 'reverso'
                });
                await tx.cashMovement.create({
                    data: {
                        shiftId: refundShiftId,
                        type: 'OUT',
                        amount: payment.amount,
                        description: `Reverso Pago Catering #${payment.id} Evento #${eventId}`,
                        reference: `REV-CAT-PAY-${payment.id}`
                    }
                });
            }

            const reversed = await tx.cateringPayment.update({
                where: { id: payment.id },
                data: {
                    status: 'REVERSED',
                    reversedAt: new Date(),
                    reversedById: userId,
                    reversalReason
                }
            });

            const remainingPaid = event.payments
                .filter((candidate) => candidate.id !== payment.id && candidate.status === 'ACTIVE')
                .reduce((sum, candidate) => sum.add(new Decimal(candidate.amount)), new Decimal(0));
            const balance = Decimal.max(new Decimal(event.totalAmount).sub(remainingPaid), 0);
            await tx.cateringEvent.update({
                where: { id: event.id },
                data: {
                    balance,
                    status: event.status === 'PAID' ? 'RESERVED' : event.status
                }
            });

            await tx.auditLog.create({
                data: {
                    companyId,
                    userId,
                    entityType: 'CateringPayment',
                    entityId: payment.id,
                    action: 'REVERSE',
                    details: { eventId, amount: Number(payment.amount), reason: reversalReason }
                }
            });

            return reversed;
        });
    }

    /**
     * Transactional payment leg used exclusively by a full Catering fiscal
     * credit note. The caller owns the event lock and the surrounding DB
     * transaction; no payment can be left refunded without its fiscal document.
     */
    static async reverseAllPaymentsForFiscalCredit(
        tx: Prisma.TransactionClient,
        params: {
            eventId: number;
            companyId: number;
            userId: number;
            creditNoteNumber: string;
            reason: string;
            externalRefunds: Array<{ paymentId: number; reference: string }>;
        }
    ): Promise<Array<{
        paymentId: number;
        methodType: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
        amount: number;
        reference: string;
    }>> {
        const event = await tx.cateringEvent.findFirst({
            where: { id: params.eventId, companyId: params.companyId },
            include: { payments: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } } }
        });
        if (!event) throw new Error('Catering event not found');
        if (event.payments.length === 0) throw new Error('La factura de catering no tiene pagos activos para reembolsar');

        const refundMap = new Map(params.externalRefunds.map((refund) => [refund.paymentId, refund.reference]));
        const nonCash = event.payments.filter((payment) => payment.methodType !== 'CASH');
        for (const payment of nonCash) {
            if (!refundMap.get(payment.id)) {
                throw new Error(`Registre la referencia del reembolso externo para el pago #${payment.id}`);
            }
        }
        if ([...refundMap.keys()].some((paymentId) => !nonCash.some((payment) => payment.id === paymentId))) {
            throw new Error('Se recibió una referencia para un pago que no está activo o es efectivo');
        }

        const refunds: Array<{
            paymentId: number;
            methodType: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
            amount: number;
            reference: string;
        }> = [];
        for (const payment of event.payments) {
            let reference: string;
            if (payment.methodType === 'CASH') {
                await this.assertCashPaymentLedger(tx, {
                    paymentId: payment.id,
                    amount: payment.amount,
                    companyId: params.companyId,
                    branchId: event.branchId,
                    expectCompensation: false
                });
                const shiftId = await this.lockActorCashShift(tx, {
                    companyId: params.companyId,
                    branchId: event.branchId,
                    userId: params.userId,
                    action: 'reverso'
                });
                reference = `REV-CAT-PAY-${payment.id}`;
                await tx.cashMovement.create({ data: {
                    shiftId,
                    type: 'OUT',
                    amount: payment.amount,
                    description: `Nota de crédito ${params.creditNoteNumber} / Catering #${event.id}`,
                    reference
                } });
            } else {
                reference = refundMap.get(payment.id)!;
            }
            await tx.cateringPayment.update({
                where: { id: payment.id },
                data: {
                    status: 'REVERSED',
                    reversedAt: new Date(),
                    reversedById: params.userId,
                    reversalReason: `Nota de crédito ${params.creditNoteNumber}: ${params.reason}`
                }
            });
            refunds.push({
                paymentId: payment.id,
                methodType: payment.methodType,
                amount: Number(payment.amount),
                reference
            });
        }
        return refunds;
    }

    private static async assertCashPaymentLedger(
        tx: Prisma.TransactionClient,
        params: {
            paymentId: number;
            amount: unknown;
            companyId: number;
            branchId: number;
            expectCompensation: boolean;
        }
    ): Promise<void> {
        const movements = await tx.cashMovement.findMany({
            where: {
                reference: { in: [`CAT-PAY-${params.paymentId}`, `REV-CAT-PAY-${params.paymentId}`] }
            },
            select: {
                type: true,
                amount: true,
                reference: true,
                shift: {
                    select: {
                        companyId: true,
                        cashRegister: { select: { branchId: true } }
                    }
                }
            }
        });
        const expectedCents = Math.round(Number(params.amount) * 100);
        const inboundReference = movements.filter((movement) =>
            movement.reference === `CAT-PAY-${params.paymentId}`
        );
        const inbound = inboundReference.filter((movement) =>
            movement.type === 'IN'
            && Math.round(Number(movement.amount) * 100) === expectedCents
            && movement.shift.companyId === params.companyId
            && movement.shift.cashRegister.branchId === params.branchId
        );
        if (inboundReference.length !== 1 || inbound.length !== 1) {
            throw new Error('El pago en efectivo no tiene exactamente un asiento CAT-PAY íntegro; requiere remediación manual');
        }
        const outboundReference = movements.filter((movement) =>
            movement.reference === `REV-CAT-PAY-${params.paymentId}`
        );
        const outbound = outboundReference.filter((movement) =>
            movement.type === 'OUT'
            && Math.round(Number(movement.amount) * 100) === expectedCents
            && movement.shift.companyId === params.companyId
            && movement.shift.cashRegister.branchId === params.branchId
        );
        if (params.expectCompensation && (outboundReference.length !== 1 || outbound.length !== 1)) {
            throw new Error('El pago revertido no tiene exactamente un asiento REV-CAT-PAY íntegro; requiere remediación manual');
        }
        if (!params.expectCompensation && outboundReference.length !== 0) {
            throw new Error('El pago activo ya tiene un contramovimiento de caja; requiere remediación manual');
        }
    }

    private static async lockActorCashShift(
        tx: Prisma.TransactionClient,
        params: { companyId: number; branchId: number; userId: number; action: 'cobro' | 'reverso' }
    ): Promise<number> {
        const shift = await tx.cashShift.findFirst({
            where: {
                companyId: params.companyId,
                userId: params.userId,
                endDate: null,
                cashRegister: { branchId: params.branchId }
            },
            select: { id: true, startDate: true }
        });
        if (!shift) {
            throw new Error(`Debe abrir un turno de caja en la sucursal del evento para registrar el ${params.action} en efectivo`);
        }

        await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shift.id} AND companyId = ${params.companyId} FOR UPDATE`;
        const locked = await tx.cashShift.findFirst({
            where: {
                id: shift.id,
                companyId: params.companyId,
                userId: params.userId,
                endDate: null,
                cashRegister: { branchId: params.branchId }
            },
            select: { id: true, startDate: true }
        });
        if (!locked) {
            throw new Error(`El turno de caja fue cerrado durante el ${params.action}; vuelva a intentarlo`);
        }
        const settingName = `${params.companyId}_timezone`;
        const setting = await tx.setting.findUnique({
            where: { companyId_name: { companyId: params.companyId, name: settingName } },
            select: { value: true }
        });
        const configuredTimezone = setting?.value?.trim();
        const timezone = configuredTimezone && isValidTimeZone(configuredTimezone)
            ? configuredTimezone
            : DEFAULT_COMPANY_SETTINGS.timezone;
        if (zonedDateKey(new Date(locked.startDate), timezone) !== zonedDateKey(new Date(), timezone)) {
            throw new Error(
                `Tiene un turno de caja de un día anterior; ciérrelo y abra uno nuevo antes de registrar el ${params.action} en efectivo`
            );
        }
        return locked.id;
    }

    // Services Catalog
    static async getAllServices(companyId: number) {
        return await prisma.cateringService.findMany({
            where: { companyId, active: true }
        });
    }

    static async createService(
        companyId: number,
        data: Omit<Prisma.CateringServiceUncheckedCreateInput, 'companyId'>
    ) {
        const name = String(data.name || '').trim();
        const internalCost = Number(data.internalCost);
        const salePrice = Number(data.salePrice);
        if (!name) throw new Error('El nombre del servicio es requerido');
        if (!Number.isFinite(internalCost) || internalCost < 0) throw new Error('El costo interno no puede ser negativo');
        if (!Number.isFinite(salePrice) || salePrice < 0) throw new Error('El precio de venta no puede ser negativo');
        return await prisma.cateringService.create({
            data: {
                companyId,
                name,
                description: data.description,
                internalCost,
                salePrice,
                active: data.active ?? true
            }
        });
    }

    static async updateService(id: number, companyId: number, data: Prisma.CateringServiceUpdateInput) {
        const name = data.name === undefined ? undefined : String(data.name).trim();
        const internalCost = data.internalCost === undefined ? undefined : Number(data.internalCost);
        const salePrice = data.salePrice === undefined ? undefined : Number(data.salePrice);
        if (name !== undefined && !name) throw new Error('El nombre del servicio es requerido');
        if (internalCost !== undefined && (!Number.isFinite(internalCost) || internalCost < 0)) throw new Error('El costo interno no puede ser negativo');
        if (salePrice !== undefined && (!Number.isFinite(salePrice) || salePrice < 0)) throw new Error('El precio de venta no puede ser negativo');
        return await prisma.cateringService.update({
            where: { id, companyId },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(internalCost !== undefined ? { internalCost } : {}),
                ...(salePrice !== undefined ? { salePrice } : {}),
                ...(data.active !== undefined ? { active: data.active } : {})
            }
        });
    }

    static async deleteService(id: number, companyId: number) {
        // Soft delete by setting active to false
        return await prisma.cateringService.update({
            where: { id, companyId },
            data: { active: false }
        });
    }

    // Inventory check (Opportunity Cost)
    static async checkResourceAvailability(date: Date, companyId: number, branchId?: number) {
        if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
        const timeZone = await SettingService.getTimezone(companyId);
        const { start: startOfDay, endInclusive: endOfDay } = getZonedDayBounds(timeZone, date);

        const eventsOnDate = await prisma.cateringEvent.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
                date: { gte: startOfDay, lte: endOfDay },
                // Forecast only demand that has not been physically consumed.
                // FINISHED events already posted their inventory OUT movements;
                // counting them again would double the requirement for the day.
                status: { notIn: ['CANCELLED', 'FINISHED'] }
            },
            include: {
                menuItems: {
                    include: {
                        menuItem: {
                            include: {
                                recipes: {
                                    include: { product: true }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Aggregate required ingredients
        const requirements: Record<number, { name: string; quantity: Decimal }> = {};

        for (const event of eventsOnDate) {
            for (const cMenuItem of event.menuItems) {
                for (const recipe of cMenuItem.menuItem.recipes) {
                    const conv = await this.convertRecipeQuantityToBase(recipe, companyId);
                    const totalNeeded = new Decimal(conv.baseQuantity).mul(cMenuItem.quantity);
                    if (!requirements[recipe.productId]) {
                        requirements[recipe.productId] = {
                            name: recipe.product.name,
                            quantity: new Decimal(0)
                        };
                    }
                    requirements[recipe.productId].quantity = requirements[recipe.productId].quantity.add(totalNeeded);
                }
            }
        }

        // Compare with stock
        const alerts = [];
        for (const productIdStr in requirements) {
            const productId = parseInt(productIdStr);
            const req = requirements[productId];

            const stocks = await prisma.stock.findMany({
                where: {
                    productId,
                    companyId,
                    ...(branchId ? { warehouse: { branchId, companyId } } : {})
                }
            });
            const totalStock = stocks.reduce((acc, s) => acc.add(new Decimal(s.quantity)), new Decimal(0));

            if (totalStock.lt(req.quantity)) {
                const deficit = req.quantity.sub(totalStock);
                alerts.push({
                    productId,
                    productName: req.name,
                    required: Number(req.quantity.toFixed(4)),
                    available: Number(totalStock.toFixed(4)),
                    deficit: Number(deficit.toFixed(4))
                });
            }
        }

        return {
            eventCount: eventsOnDate.length,
            alerts
        };
    }
}
