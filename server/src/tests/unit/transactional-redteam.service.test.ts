import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CateringService } from '../../services/catering.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import { ReportService } from '../../services/report.service';
import { ReservationService } from '../../services/reservation.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('transactional red-team regressions', () => {
    it('cannot bypass cancellation counterflows through generic status update', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ id: 9, status: 'OPEN' })),
                update: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(OrderService.updateStatus(9, 1, 'CANCELLED'))
            .rejects.toThrow(/flujo dedicado/i);
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('rejects changing order lines after a partial payment exists', async () => {
        jest.spyOn(prisma.menuItem, 'findFirst').mockResolvedValue({
            id: 4, companyId: 1, active: true, branchId: null, price: 25,
            modifierGroups: []
        } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, status: 'OPEN',
                    payments: [{ id: 33 }]
                }))
            },
            orderItem: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(OrderService.addItem(9, 1, { menuItemId: 4, quantity: 1 }))
            .rejects.toThrow(/pagos activos/i);
        expect(tx.orderItem.create).not.toHaveBeenCalled();
    });

    it('does not post cash into a shift closed concurrently', async () => {
        const shiftLookup = jest.fn(async (): Promise<{ id: number; cashRegisterId: number; startDate: Date } | null> => null);
        shiftLookup
            .mockResolvedValueOnce({ id: 5, cashRegisterId: 3, startDate: new Date() })
            .mockResolvedValueOnce(null);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 100,
                    financialStatus: 'UNPAID', status: 'OPEN', cashRegisterId: null,
                    invoiceNumber: 'FAC-2-000009', invoiceFiscalStatus: 'ISSUED', payments: [], items: []
                })),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 2, name: 'Etiqueta personalizada', type: 'CASH' })) },
            payment: { create: jest.fn(async () => ({ id: 44, amount: 10 })) },
            setting: { findUnique: jest.fn(async () => null) },
            cashShift: {
                findFirst: shiftLookup
            },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 2, amount: 10
        }, 7)).rejects.toThrow(/cerrado durante el cobro/i);
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('does not infer cash behavior from a misleading display name', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 100,
                    financialStatus: 'UNPAID', status: 'OPEN', cashRegisterId: null,
                    invoiceNumber: 'FAC-2-000009', invoiceFiscalStatus: 'ISSUED', payments: [], items: []
                })),
                update: jest.fn()
            },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 2, name: 'Efectivo', type: 'CARD' })) },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: { create: jest.fn(async () => ({ id: 44, amount: 10 })) },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 2, amount: 10 }, 7);

        expect(tx.cashMovement.create).not.toHaveBeenCalled();
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ financialStatus: 'PARTIAL' })
        }));
    });

    it('revalidates an active tenant payment method under the order transaction lock', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 100,
                    financialStatus: 'UNPAID', status: 'OPEN', cashRegisterId: null,
                    invoiceNumber: 'FAC-2-000009', invoiceFiscalStatus: 'ISSUED', payments: [], items: []
                }))
            },
            paymentMethod: { findFirst: jest.fn(async (_args?: unknown) => null) },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: { create: jest.fn() },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 77, amount: 10
        }, 7)).rejects.toThrow(/invalid or inactive/i);

        expect(tx.paymentMethod.findFirst).toHaveBeenCalledWith({
            where: { id: 77, active: true, OR: [{ companyId: 1 }, { companyId: null }] },
            select: { id: true, type: true }
        });
        expect(tx.payment.create).not.toHaveBeenCalled();
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a foreign or inactive catering payment method before any cash mutation', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cateringEvent: {
                findFirst: jest.fn(async () => ({
                    id: 3, companyId: 1, branchId: 2, status: 'RESERVED', totalAmount: 40, payments: []
                }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async (_args?: unknown) => null) },
            cateringPayment: { create: jest.fn() },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CateringService.addPayment(3, 1, 7, {
            amount: 40, paymentMethodId: 99
        })).rejects.toThrow(/inactivo|no válido/i);

        expect(tx.paymentMethod.findFirst).toHaveBeenCalledWith({
            where: { id: 99, active: true, OR: [{ companyId: 1 }, { companyId: null }] },
            select: { id: true, type: true }
        });
        expect(tx.cateringPayment.create).not.toHaveBeenCalled();
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('rolls back a catering cash charge when its branch shift closes concurrently', async () => {
        const shiftLookup = jest.fn(async (_args?: unknown): Promise<{ id: number; startDate: Date } | null> => null);
        shiftLookup.mockResolvedValueOnce({ id: 5, startDate: new Date() }).mockResolvedValueOnce(null);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cateringEvent: {
                findFirst: jest.fn(async () => ({
                    id: 3, companyId: 1, branchId: 2, status: 'RESERVED', totalAmount: 40, payments: []
                }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 8, type: 'CASH' })) },
            setting: { findUnique: jest.fn(async () => ({ value: 'America/Managua' })) },
            cashShift: { findFirst: shiftLookup },
            cateringPayment: { create: jest.fn() },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CateringService.addPayment(3, 1, 7, {
            amount: 40, paymentMethodId: 8
        })).rejects.toThrow(/cerrado durante el cobro/i);

        expect(shiftLookup).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ companyId: 1, userId: 7, cashRegister: { branchId: 2 } })
        }));
        expect(tx.cateringPayment.create).not.toHaveBeenCalled();
    });

    it('rejects catering cash charges on a shift from a previous company-local day', async () => {
        const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cateringEvent: {
                findFirst: jest.fn(async () => ({
                    id: 3, companyId: 1, branchId: 2, status: 'RESERVED', totalAmount: 40, payments: []
                }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 8, type: 'CASH' })) },
            setting: { findUnique: jest.fn(async () => ({ value: 'America/Managua' })) },
            cashShift: { findFirst: jest.fn(async () => ({ id: 5, startDate: yesterday })) },
            cateringPayment: { create: jest.fn() },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CateringService.addPayment(3, 1, 7, {
            amount: 40, paymentMethodId: 8
        })).rejects.toThrow(/turno de caja de un día anterior/i);
        expect(tx.cateringPayment.create).not.toHaveBeenCalled();
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('reverses multiple consumptions at their weighted outstanding value', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            inventoryMovement: {
                findMany: jest.fn(async () => [
                    { warehouseId: 2, productId: 8, type: 'OUT', quantity: 1, unitCost: 10 },
                    { warehouseId: 2, productId: 8, type: 'OUT', quantity: 2, unitCost: 20 }
                ])
            }
        };
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({} as never);

        await InventoryConsumptionService.reverseForOrder(tx as never, {
            orderId: 9,
            companyId: 1,
            userId: 7,
            reason: 'Reversa de prueba',
            sourceType: 'ADJUSTMENT',
            reversalOrigin: 'UNIT_TEST'
        });

        expect(apply).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            quantity: 3,
            unitCost: 50 / 3,
            reference: 'ORD-9',
            origin: 'REVERSAL',
            reversalGroupId: 'UNIT_TEST',
            reversalKey: 'UNIT_TEST:8:2'
        }));
    });

    it('recreates the exact FIFO portions when order-consumption lineage is available', async () => {
        const acquiredAt = '2026-01-02T03:04:05.000Z';
        const tx = {
            $queryRaw: jest.fn(async () => []),
            inventoryMovement: {
                findMany: jest.fn(async () => [{
                    warehouseId: 2,
                    productId: 8,
                    type: 'OUT',
                    quantity: 3,
                    unitCost: 50 / 3,
                    totalCost: 50,
                    consumedLayers: [
                        { quantity: 1, unitCost: 10, sourceRef: 'PO-1', sourceType: 'PURCHASE', createdAt: acquiredAt },
                        { quantity: 2, unitCost: 20, sourceRef: 'PO-2', sourceType: 'PURCHASE', createdAt: acquiredAt }
                    ]
                }])
            }
        };
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({} as never);

        await InventoryConsumptionService.reverseForOrder(tx as never, {
            orderId: 9,
            companyId: 1,
            userId: 7,
            reason: 'Reversa de prueba',
            sourceType: 'ADJUSTMENT',
            reversalOrigin: 'UNIT_TEST'
        });

        expect(apply).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            inboundLayers: [
                expect.objectContaining({ quantity: 1, unitCost: 10, sourceRef: 'PO-1', sourceType: 'PURCHASE' }),
                expect.objectContaining({ quantity: 2, unitCost: 20, sourceRef: 'PO-2', sourceType: 'PURCHASE' })
            ],
            sourceType: undefined
        }));
    });

    it('fails closed when a consumption reversal has neither total nor unit cost', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            inventoryMovement: {
                findMany: jest.fn(async () => [{
                    id: 91, warehouseId: 2, productId: 8, type: 'OUT',
                    quantity: 3, unitCost: null, totalCost: null, consumedLayers: null
                }])
            }
        };
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({} as never);

        await expect(InventoryConsumptionService.reverseForOrder(tx as never, {
            orderId: 9,
            companyId: 1,
            userId: 7,
            reason: 'Reversa de prueba',
            sourceType: 'ADJUSTMENT',
            reversalOrigin: 'UNIT_TEST'
        })).rejects.toThrow(/no tiene costo total ni unitario íntegro/i);
        expect(apply).not.toHaveBeenCalled();
    });

    it('does not let another product IN cancel the idempotency guard', async () => {
        const tx = {
            inventoryMovement: {
                findMany: jest.fn(async () => [
                    { warehouseId: 2, productId: 8, type: 'OUT', quantity: 1 },
                    { warehouseId: 2, productId: 9, type: 'IN', quantity: 1 }
                ])
            },
            orderItemModifier: { findMany: jest.fn() }
        };

        const result = await InventoryConsumptionService.consumeForOrder(tx as never, {
            order: { id: 9, userId: 7, items: [] },
            warehouseId: 2,
            companyId: 1,
            userId: 7
        });

        expect(result).toEqual({ consumed: false });
        expect(tx.orderItemModifier.findMany).not.toHaveBeenCalled();
    });

    it('keeps idempotency after a partial reversal of one product bucket', async () => {
        const tx = {
            inventoryMovement: {
                findMany: jest.fn(async () => [
                    { warehouseId: 2, productId: 8, type: 'OUT', quantity: 3 },
                    { warehouseId: 2, productId: 8, type: 'IN', quantity: 2 }
                ])
            },
            orderItemModifier: { findMany: jest.fn() }
        };

        const result = await InventoryConsumptionService.consumeForOrder(tx as never, {
            order: { id: 10, userId: 7, items: [] },
            warehouseId: 2,
            companyId: 1,
            userId: 7
        });

        expect(result).toEqual({ consumed: false });
        expect(tx.orderItemModifier.findMany).not.toHaveBeenCalled();
    });

    it('uses the product base unit when a recipe has no explicit unit', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            inventoryMovement: { findMany: jest.fn(async () => []) },
            orderItemModifier: { findMany: jest.fn(async () => []) }
        };
        const convert = jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 0.25,
            baseUnit: 'kg',
            originalQuantity: 0.25,
            originalUnit: 'kg',
            conversionFactor: 1
        });
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({} as never);

        await InventoryConsumptionService.consumeForOrder(tx as never, {
            order: {
                id: 11,
                userId: 7,
                items: [{
                    quantity: 2,
                    menuItem: {
                        recipes: [{
                            productId: 8,
                            quantity: 0.25,
                            product: { name: 'Harina', unit: 'lb', baseUnit: { abbreviation: 'kg' } }
                        }]
                    }
                }]
            },
            warehouseId: 2,
            companyId: 1,
            userId: 7
        });

        expect(convert).toHaveBeenCalledWith(8, 1, 0.25, 'kg', tx as never);
    });

    it('freezes catering financial lines once an active payment exists', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue({
            status: 'RESERVED', customerId: null,
            services: [{ subtotal: 100 }], menuItems: [], payments: [{ status: 'ACTIVE' }]
        } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cateringEvent: {
                findFirst: jest.fn(async () => ({ status: 'RESERVED', payments: [{ id: 1 }] }))
            },
            cateringServiceItem: { deleteMany: jest.fn() },
            cateringMenuItem: { deleteMany: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CateringService.updateEvent(3, 1, 7, { services: [] }))
            .rejects.toThrow(/pagos activos/i);
        expect(tx.cateringServiceItem.deleteMany).not.toHaveBeenCalled();
    });

    it('rechecks reservation status under lock before deletion', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            reservation: {
                findFirst: jest.fn(async () => ({ id: 3, status: 'CONFIRMED' })),
                delete: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(ReservationService.delete(3, 1)).rejects.toThrow(/pending or cancelled/i);
        expect(tx.reservation.delete).not.toHaveBeenCalled();
    });

    it('includes financially settled DELIVERED orders in dashboard sales', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const orderLookup = jest.spyOn(prisma.order, 'findMany')
            .mockResolvedValue([{ total: 125 }] as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([{ total: 25 }] as never);
        const orderCount = jest.spyOn(prisma.order, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.purchaseOrder, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.table, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.reservation, 'aggregate').mockResolvedValue({
            _sum: { peopleCount: 0 }
        } as never);

        const result = await ReportService.getDashboardStats(1, 2);

        expect(result.todaySales).toBe(100);
        expect(orderLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
                    { status: 'CANCELLED', invoiceFiscalStatus: 'CREDITED' }
                ]),
                closedAt: expect.objectContaining({ not: null, gte: expect.any(Date) })
            })
        }));
        expect(orderCount).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
            })
        }));
    });
});
