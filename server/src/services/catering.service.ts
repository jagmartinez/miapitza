import prisma from '../utils/prisma';
import type { CateringPaymentType, Prisma } from '@prisma/client';
import { CateringStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { getErrorMessage } from '../utils/error';
import { UnitConversionService } from './unit-conversion.service';
import { InventoryEngineService } from './inventory-engine.service';

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
                }
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
            const found = await prisma.cateringService.findMany({ where: { id: { in: serviceIds }, companyId }, select: { id: true } });
            if (found.length !== serviceIds.length) throw new Error('Uno o más servicios no pertenecen a esta empresa');
        }
        const menuIds = [...new Set((refs.menuItemIds || []).filter((n) => Number.isFinite(n)))];
        if (menuIds.length) {
            const found = await prisma.menuItem.findMany({ where: { id: { in: menuIds }, companyId }, select: { id: true } });
            if (found.length !== menuIds.length) throw new Error('Uno o más ítems de menú no pertenecen a esta empresa');
        }
    }

    static async createEvent(companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, ...eventData } = data;
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
        if (!branch) throw new Error('Sucursal no encontrada para esta empresa');

        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;
        let createCustomer = false;

        // If no customerId but name is provided, find or create
        if (!customerId && customerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: customerName, companyId }
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
            const quantity = Number(s.quantity);
            const unitPrice = Number(s.unitPrice);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad del servicio debe ser mayor a 0');
            if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio del servicio no puede ser negativo');
            const subtotal = new Decimal(s.quantity).mul(new Decimal(s.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                cateringServiceId: parseInt(String(s.cateringServiceId), 10),
                quantity: new Decimal(s.quantity),
                unitPrice: new Decimal(s.unitPrice),
                subtotal,
                notes: s.notes
            };
        }) || [];

        // Menu items total
        const menuItemsToCreate = menuItems?.map((m) => {
            const quantity = Number(m.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('La cantidad de platos del menÃº debe ser un entero mayor a 0');
            }
            if (!Number.isFinite(Number(m.unitPrice)) || Number(m.unitPrice) < 0) {
                throw new Error('El precio del plato no puede ser negativo');
            }
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId: parseInt(String(m.menuItemId), 10),
                quantity,
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        // Ensure customer / services / menu items all belong to this company.
        await this.assertEventRefs(companyId, {
            customerId,
            serviceIds: servicesToCreate.map((s) => s.cateringServiceId),
            menuItemIds: menuItemsToCreate.map((m) => m.menuItemId),
        });

        const cleanEventData: Record<string, unknown> = {
            title: eventData.title,
            peopleCount: eventData.peopleCount,
            status: 'QUOTED',
            location: eventData.location,
            notes: eventData.notes,
            clauses: eventData.clauses
        };

        try {
            // Create the event and (if it starts FINISHED) deduct inventory in the
            // SAME transaction so a deduction failure rolls back the event.
            const event = await prisma.$transaction(async (tx) => {
                if (createCustomer && customerName) {
                    const customer = await tx.customer.create({ data: { name: customerName, phone: customerPhone, taxId: customerTaxId, companyId } });
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
                        services: { create: servicesToCreate },
                        menuItems: { create: menuItemsToCreate },
                        date:
                            eventData.date != null
                                ? new Date(eventData.date as string | number | Date)
                                : undefined
                    } as Prisma.CateringEventCreateInput,
                    include: {
                        customer: true,
                        services: true,
                        menuItems: true
                    }
                });

                // Trigger inventory deduction if status is FINISHED upon creation
                if (created.status === 'FINISHED') {
                    await this.deductInventoryTx(tx, created.id, companyId, userId);
                }

                return created;
            });

            return event;
        } catch (error: unknown) {
            console.error('Error creating catering event:', error);
            throw new Error(`Failed to create catering event: ${getErrorMessage(error)}`);
        }
    }

    static async updateEvent(id: number, companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, ...eventData } = data;

        // Tenant-scoped load: never operate on another company's event.
        const oldEvent = await prisma.cateringEvent.findFirst({
            where: { id, companyId },
            select: {
                status: true,
                customerId: true,
                services: { select: { subtotal: true } },
                menuItems: { select: { subtotal: true } },
                payments: { select: { status: true } }
            }
        });

        if (!oldEvent) throw new Error('Catering event not found');

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
        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;
        let createCustomer = false;

        // If no customerId but name is provided, find or create
        if (!customerId && customerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: customerName, companyId }
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
            const quantity = Number(s.quantity);
            const unitPrice = Number(s.unitPrice);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad del servicio debe ser mayor a 0');
            if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio del servicio no puede ser negativo');
            const subtotal = new Decimal(s.quantity).mul(new Decimal(s.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                cateringServiceId: parseInt(String(s.cateringServiceId), 10),
                quantity: new Decimal(s.quantity),
                unitPrice: new Decimal(s.unitPrice),
                subtotal,
                notes: s.notes
            };
        }) || [];

        const menuItemsToUpdate = menuItems?.map((m) => {
            const quantity = Number(m.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('La cantidad de platos del menÃº debe ser un entero mayor a 0');
            }
            if (!Number.isFinite(Number(m.unitPrice)) || Number(m.unitPrice) < 0) throw new Error('El precio del plato no puede ser negativo');
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId: parseInt(String(m.menuItemId), 10),
                quantity,
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        // Ensure branch / customer / services / menu items belong to this company.
        await this.assertEventRefs(companyId, {
            branchId,
            customerId,
            serviceIds: servicesToUpdate.map((s) => s.cateringServiceId),
            menuItemIds: menuItemsToUpdate.map((m) => m.menuItemId),
        });

        const { date } = eventData;
        const cleanEventData: Record<string, unknown> = {};
        for (const field of ['title', 'peopleCount', 'status', 'location', 'notes', 'clauses'] as const) {
            if (eventData[field] !== undefined) cleanEventData[field] = eventData[field];
        }

        try {
            const updatedEvent = await prisma.$transaction(async (tx) => {
                if (createCustomer && customerName) {
                    const customer = await tx.customer.create({ data: { name: customerName, phone: customerPhone, taxId: customerTaxId, companyId } });
                    customerId = customer.id;
                } else if (customerId && (customerName || customerPhone || customerTaxId)) {
                    await tx.customer.updateMany({ where: { id: customerId, companyId }, data: { name: customerName, phone: customerPhone, taxId: customerTaxId } });
                }
                await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
                const locked = await tx.cateringEvent.findFirst({
                    where: { id, companyId },
                    select: { status: true, payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
                });
                if (!locked) throw new Error('Catering event not found');
                if (locked.status !== oldEvent.status) throw new Error('El evento cambió de estado; recargue e intente nuevamente');
                if (data.status === 'CANCELLED' && locked.payments.length > 0) throw new Error('No se puede cancelar un evento con pagos activos; revierta los pagos primero');
                if ((services !== undefined || menuItems !== undefined) && locked.payments.length > 0) {
                    throw new Error('No se pueden modificar conceptos o totales de un evento con pagos activos; revierta los pagos primero');
                }
                if (services !== undefined) await tx.cateringServiceItem.deleteMany({ where: { cateringEventId: id } });
                if (menuItems !== undefined) await tx.cateringMenuItem.deleteMany({ where: { cateringEventId: id } });

                const updateData = {
                    ...cleanEventData,
                    totalAmount,
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
                    await this.deductInventoryTx(tx, id, companyId, userId);
                }

                return finalEvent;
            });

            return updatedEvent;
        } catch (error: unknown) {
            console.error('Error updating catering event:', error);
            throw new Error(`Failed to update catering event: ${getErrorMessage(error)}`);
        }
    }

    private static async deductInventoryTx(tx: Prisma.TransactionClient, eventId: number, companyId: number, userId: number) {
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

        if (!event) return;

        // IDEMPOTENCY GUARD: skip when this event's stock is already deducted.
        // Mirrors order consumption: net = OUT - reversal IN for the stable ref.
        const reference = `EVT-${event.id}`;
        const priorMovements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { type: true, quantity: true }
        });
        const netConsumed = priorMovements.reduce((net, m) => {
            const qty = Number(m.quantity);
            return m.type === 'OUT' ? net + qty : net - qty;
        }, 0);
        if (netConsumed > 1e-9) return;

        const warehouse = await tx.warehouse.findFirst({
            where: { branchId: event.branchId, companyId }
        }) || await tx.warehouse.findFirst({
            where: { companyId }
        });

        if (!warehouse) throw new Error('No se encontró almacén para la deducción de inventario');

        for (const cMenuItem of event.menuItems) {
            for (const recipe of cMenuItem.menuItem.recipes) {
                const conv = await this.convertRecipeQuantityToBase(recipe, companyId, tx);
                const totalNeeded = conv.baseQuantity * cMenuItem.quantity;

                // Stock lock, availability check, costing, FIFO-layer consumption
                // and the OUT movement are handled by the single inventory engine.
                await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId: warehouse.id,
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

    static async deleteEvent(id: number, companyId: number) {
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
            return await tx.cateringEvent.delete({ where: { id } });
        });
    }

    static async addPayment(
        eventId: number,
        companyId: number,
        paymentData: {
            amount: number | string | Decimal;
            paymentMethodId: number;
            type?: CateringPaymentType;
            reference?: string | null;
        }
    ) {
        const rawAmount = Number(paymentData.amount);
        if (!Number.isFinite(rawAmount)) {
            throw new Error('El monto debe ser un numero finito');
        }
        const amount = Math.round(rawAmount * 100) / 100;
        if (amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }

        return await prisma.$transaction(async (tx) => {
            // Pessimistic lock: serialize concurrent payments on the same event
            // so the balance check and update cannot race.
            await tx.$queryRaw`SELECT id FROM \`CateringEvent\` WHERE id = ${eventId} AND companyId = ${companyId} FOR UPDATE`;

            const event = await tx.cateringEvent.findFirst({
                where: { id: eventId, companyId },
                include: { payments: true }
            });

            if (!event) {
                throw new Error('Catering event not found');
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
            const method = await tx.paymentMethod.findFirst({
                where: { id: paymentData.paymentMethodId, OR: [{ companyId }, { companyId: null }] },
                select: { id: true }
            });
            if (!method) throw new Error('Método de pago no válido para esta empresa');

            // Recompute balance from the authoritative total minus paid amounts
            // INSIDE the locked transaction (do not trust the stored balance).
            const paid = event.payments
                .filter((payment) => payment.status === 'ACTIVE')
                .reduce((sum, payment) => sum.add(new Decimal(payment.amount)), new Decimal(0));
            const currentBalance = new Decimal(event.totalAmount).sub(paid);

            if (amount > Number(currentBalance) + 0.01) {
                throw new Error(`El monto excede el saldo pendiente de ${Number(currentBalance).toFixed(2)}`);
            }

            const payment = await tx.cateringPayment.create({
                data: {
                    amount,
                    paymentMethodId: paymentData.paymentMethodId,
                    type: paymentData.type || 'ADVANCE',
                    reference: reference || null,
                    cateringEventId: eventId
                }
            });

            const newBalance = currentBalance.sub(new Decimal(amount));
            await tx.cateringEvent.update({
                where: { id: eventId },
                data: {
                    balance: newBalance,
                    status: newBalance.lte(0) ? 'PAID' : event.status
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
                include: { payments: true }
            });
            if (!event) throw new Error('Catering event not found');
            if (event.status === 'FINISHED') {
                throw new Error('No se puede revertir un pago de un evento finalizado');
            }

            const payment = event.payments.find((candidate) => candidate.id === paymentId);
            if (!payment) throw new Error('Pago de catering no encontrado');
            if (payment.status === 'REVERSED') return payment;

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
        return await prisma.cateringService.create({
            data: {
                companyId,
                name: String(data.name).trim(),
                description: data.description,
                internalCost: data.internalCost,
                salePrice: data.salePrice,
                active: data.active ?? true
            }
        });
    }

    static async updateService(id: number, companyId: number, data: Prisma.CateringServiceUpdateInput) {
        return await prisma.cateringService.update({
            where: { id, companyId },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.internalCost !== undefined ? { internalCost: data.internalCost } : {}),
                ...(data.salePrice !== undefined ? { salePrice: data.salePrice } : {}),
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
    static async checkResourceAvailability(date: Date, companyId: number) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const eventsOnDate = await prisma.cateringEvent.findMany({
            where: {
                companyId,
                date: { gte: startOfDay, lte: endOfDay },
                status: { not: 'CANCELLED' }
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
                where: { productId, companyId }
            });
            const totalStock = stocks.reduce((acc, s) => acc.add(new Decimal(s.quantity)), new Decimal(0));

            if (totalStock.lt(req.quantity)) {
                alerts.push({
                    productId,
                    productName: req.name,
                    required: req.quantity,
                    available: totalStock,
                    deficit: req.quantity.sub(totalStock)
                });
            }
        }

        return {
            eventCount: eventsOnDate.length,
            alerts
        };
    }
}
