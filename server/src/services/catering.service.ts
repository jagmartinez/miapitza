import prisma from '../utils/prisma';
import type { CateringPaymentType, Prisma } from '@prisma/client';
import { CateringStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryMovementService } from './inventory-movement.service';
import { getErrorMessage } from '../utils/error';
import { UnitConversionService } from './unit-conversion.service';

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

export class CateringService {
    private static async convertRecipeQuantityToBase(
        recipe: { productId: number; quantity: Decimal | number | string; unit?: string | null; product: { unit: string } },
        companyId: number,
        tx?: Prisma.TransactionClient
    ) {
        const recipeUnit = recipe.unit || recipe.product.unit;
        const recipeQty = Number(recipe.quantity);
        let baseQuantity = recipeQty;
        let originalQuantity: number | null = null;
        let originalUnit: string | null = null;
        let conversionFactor: number | null = null;

        try {
            const conv = await UnitConversionService.convert(
                recipe.productId,
                companyId,
                recipeQty,
                recipeUnit,
                tx
            );
            baseQuantity = conv.baseQuantity;
            originalQuantity = conv.originalQuantity;
            originalUnit = conv.originalUnit;
            conversionFactor = conv.conversionFactor;
        } catch {
            // Fallback to legacy 1:1 when conversion is not configured
        }

        return { baseQuantity, originalQuantity, originalUnit, conversionFactor, recipeUnit };
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

    static async createEvent(companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, ...eventData } = data;

        // Ensure branchId is an Int
        const branchId = parseInt(String(eventData.branchId), 10);
        if (isNaN(branchId)) throw new Error('Valid branchId is required');

        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;

        // If no customerId but name is provided, find or create
        if (!customerId && customerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: customerName, companyId }
            });

            if (customer) {
                customerId = customer.id;
                // Update taxId if provided
                if (customerTaxId && customer.taxId !== customerTaxId) {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { taxId: customerTaxId }
                    });
                }
            } else {
                const newCustomer = await prisma.customer.create({
                    data: {
                        name: customerName,
                        phone: customerPhone,
                        taxId: customerTaxId,
                        companyId
                    }
                });
                customerId = newCustomer.id;
            }
        }

        // Calculate initial total
        let totalAmount = new Decimal(0);

        // Services total
        const servicesToCreate = services?.map((s) => {
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
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId: parseInt(String(m.menuItemId), 10),
                quantity: parseInt(String(m.quantity), 10),
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        const cleanEventData = { ...eventData } as Record<string, unknown>;
        delete cleanEventData.branchId;
        delete cleanEventData.companyId;
        delete cleanEventData.customerId;

        try {
            const event = await prisma.cateringEvent.create({
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
            if (event.status === 'FINISHED') {
                await this.deductInventory(event.id, companyId, userId);
            }

            return event;
        } catch (error: unknown) {
            console.error('Error creating catering event:', error);
            throw new Error(`Failed to create catering event: ${getErrorMessage(error)}`);
        }
    }

    static async updateEvent(id: number, companyId: number, userId: number, data: CateringEventWriteBody) {
        const { services, menuItems, customerName, customerPhone, customerTaxId, customerId: cid, ...eventData } = data;

        const oldEvent = await prisma.cateringEvent.findUnique({
            where: { id },
            select: { status: true, customerId: true }
        });

        // Validate status transition if status is changing
        if (data.status && oldEvent && data.status !== oldEvent.status) {
            const validNext = this.VALID_STATUS_TRANSITIONS[oldEvent.status] || [];
            if (!validNext.includes(data.status)) {
                throw new Error(`Transición de estado inválida: ${oldEvent.status} → ${data.status}`);
            }
        }

        // Optional conversions
        const branchId =
            eventData.branchId != null && eventData.branchId !== ''
                ? parseInt(String(eventData.branchId), 10)
                : undefined;
        let customerId = cid != null && cid !== '' ? parseInt(String(cid), 10) : undefined;

        // If no customerId but name is provided, find or create
        if (!customerId && customerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: customerName, companyId }
            });

            if (customer) {
                customerId = customer.id;
                // Update taxId if provided
                if (customerTaxId && customer.taxId !== customerTaxId) {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { taxId: customerTaxId }
                    });
                }
            } else {
                const newCustomer = await prisma.customer.create({
                    data: {
                        name: customerName,
                        phone: customerPhone,
                        taxId: customerTaxId,
                        companyId
                    }
                });
                customerId = newCustomer.id;
            }
        } else if (customerId && (customerName || customerPhone || customerTaxId)) {
            // Update existing customer info
            await prisma.customer.update({
                where: { id: customerId },
                data: {
                    name: customerName,
                    phone: customerPhone,
                    taxId: customerTaxId
                }
            });
        }

        // Recalculate totals
        let totalAmount = new Decimal(0);
        const servicesToUpdate = services?.map((s) => {
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
            const subtotal = new Decimal(m.quantity).mul(new Decimal(m.unitPrice));
            totalAmount = totalAmount.add(subtotal);
            return {
                menuItemId: parseInt(String(m.menuItemId), 10),
                quantity: parseInt(String(m.quantity), 10),
                unitPrice: new Decimal(m.unitPrice),
                subtotal
            };
        }) || [];

        const { date, ...mutableEventData } = eventData;
        const cleanEventData = { ...mutableEventData } as Record<string, unknown>;
        delete cleanEventData.branchId;
        delete cleanEventData.companyId;
        delete cleanEventData.customerId;

        try {
            const updatedEvent = await prisma.$transaction(async (tx) => {
                // Remove old items
                await tx.cateringServiceItem.deleteMany({ where: { cateringEventId: id } });
                await tx.cateringMenuItem.deleteMany({ where: { cateringEventId: id } });

                const updateData = {
                    ...cleanEventData,
                    totalAmount,
                    services: { create: servicesToUpdate },
                    menuItems: { create: menuItemsToUpdate },
                    updatedAt: new Date()
                } as Prisma.CateringEventUpdateInput;

                if (branchId) updateData.branch = { connect: { id: branchId } };
                if (customerId) updateData.customer = { connect: { id: customerId } };
                if (date != null) updateData.date = new Date(date as string | number | Date);

                const event = await tx.cateringEvent.update({
                    where: { id },
                    data: updateData,
                    include: { payments: true }
                });

                // Recalculate balance inside transaction
                const paid = event.payments.reduce((sum, p) => sum.add(new Decimal(p.amount)), new Decimal(0));
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

                // Inline stock deduction within the same transaction
                const stock = await tx.stock.findUnique({
                    where: { warehouseId_productId: { warehouseId: warehouse.id, productId: recipe.productId } }
                });

                const currentQty = stock ? Number(stock.quantity) : 0;
                const newQty = currentQty - totalNeeded;
                if (newQty < 0) {
                    throw new Error(`Stock insuficiente para ${recipe.product.name}`);
                }

                if (stock) {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: warehouse.id, productId: recipe.productId } },
                        data: { quantity: newQty }
                    });
                } else {
                    throw new Error(`No hay stock registrado para ${recipe.product.name}`);
                }

                const unitCost = Number(recipe.product.currentAverageCost || recipe.product.cost || 0);
                await tx.inventoryMovement.create({
                    data: {
                        companyId,
                        warehouseId: warehouse.id,
                        productId: recipe.productId,
                        userId,
                        type: 'OUT',
                        quantity: totalNeeded,
                        originalQuantity: conv.originalQuantity ? conv.originalQuantity * cMenuItem.quantity : null,
                        originalUnit: conv.originalUnit,
                        conversionFactor: conv.conversionFactor,
                        reason: `Catering Event: ${event.title}`,
                        reference: `EVT-${event.id}`,
                        unitCost,
                        totalCost: totalNeeded * unitCost,
                        balanceQty: newQty,
                        balanceCost: newQty * unitCost
                    }
                });
            }
        }
    }

    private static async deductInventory(eventId: number, companyId: number, userId: number) {
        const event = await prisma.cateringEvent.findUnique({
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

        // Default warehouse for the branch or first available
        const warehouse = await prisma.warehouse.findFirst({
            where: { branchId: event.branchId, companyId }
        }) || await prisma.warehouse.findFirst({
            where: { companyId }
        });

        if (!warehouse) throw new Error('No warehouse found for inventory deduction');

        for (const cMenuItem of event.menuItems) {
            for (const recipe of cMenuItem.menuItem.recipes) {
                await InventoryMovementService.create(companyId, {
                    warehouseId: warehouse.id,
                    productId: recipe.productId,
                    userId,
                    type: 'OUT',
                    quantity: Number(recipe.quantity) * cMenuItem.quantity,
                    unit: recipe.unit || recipe.product.unit,
                    reason: `Catering Event: ${event.title}`,
                    reference: `EVT-${event.id}`
                });
            }
        }
    }

    static async deleteEvent(id: number, companyId: number) {
        const event = await this.getEventById(id, companyId);

        if (event.status !== 'QUOTED' && event.status !== 'CANCELLED') {
            throw new Error('Solo se pueden eliminar eventos en estado COTIZADO o CANCELADO');
        }

        const paymentCount = event.payments?.length || 0;
        if (paymentCount > 0) {
            throw new Error('No se puede eliminar un evento con pagos registrados');
        }

        return await prisma.$transaction(async (tx) => {
            await tx.cateringServiceItem.deleteMany({ where: { cateringEventId: id } });
            await tx.cateringMenuItem.deleteMany({ where: { cateringEventId: id } });
            return await tx.cateringEvent.delete({ where: { id } });
        });
    }

    private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
        'QUOTED': ['RESERVED', 'CANCELLED'],
        'RESERVED': ['CONFIRMED', 'CANCELLED'],
        'CONFIRMED': ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS': ['FINISHED', 'CANCELLED'],
        'PAID': ['FINISHED'],
        'FINISHED': [],
        'CANCELLED': []
    };

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
        const event = await this.getEventById(eventId, companyId);

        if (event.status === 'CANCELLED') {
            throw new Error('No se pueden agregar pagos a eventos cancelados');
        }

        const amount = Number(paymentData.amount);
        if (!amount || amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }

        const currentBalance = Number(event.balance);
        if (amount > currentBalance + 0.01) {
            throw new Error(`El monto excede el saldo pendiente de ${currentBalance.toFixed(2)}`);
        }

        return await prisma.$transaction(async (tx) => {
            const payment = await tx.cateringPayment.create({
                data: {
                    amount: paymentData.amount,
                    paymentMethodId: paymentData.paymentMethodId,
                    type: paymentData.type || 'ADVANCE',
                    reference: paymentData.reference || null,
                    cateringEventId: eventId
                }
            });

            const newBalance = new Decimal(currentBalance).sub(new Decimal(amount));
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
            data: { ...data, companyId }
        });
    }

    static async updateService(id: number, companyId: number, data: Prisma.CateringServiceUpdateInput) {
        return await prisma.cateringService.update({
            where: { id, companyId },
            data
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
