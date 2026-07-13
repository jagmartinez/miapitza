import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CateringService } from '../../services/catering.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import { ReportService } from '../../services/report.service';
import { ReservationService } from '../../services/reservation.service';

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
        jest.spyOn(prisma.paymentMethod, 'findFirst').mockResolvedValue({
            id: 2, name: 'EFECTIVO', active: true
        } as never);
        const shiftLookup = jest.fn(async (): Promise<{ id: number; cashRegisterId: number } | null> => null);
        shiftLookup
            .mockResolvedValueOnce({ id: 5, cashRegisterId: 3 })
            .mockResolvedValueOnce(null);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 100,
                    status: 'OPEN', cashRegisterId: null, payments: [], items: []
                })),
                update: jest.fn()
            },
            payment: { create: jest.fn(async () => ({ id: 44, amount: 10 })) },
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

    it('reverses multiple consumptions at their weighted outstanding value', async () => {
        const tx = {
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
            orderId: 9, companyId: 1, userId: 7
        });

        expect(apply).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            quantity: 3,
            unitCost: 50 / 3,
            reference: 'ORD-9'
        }));
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
        const orderCount = jest.spyOn(prisma.order, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.purchaseOrder, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.table, 'count').mockResolvedValue(0);
        jest.spyOn(prisma.reservation, 'aggregate').mockResolvedValue({
            _sum: { peopleCount: 0 }
        } as never);

        const result = await ReportService.getDashboardStats(1, 2);

        expect(result.todaySales).toBe(125);
        expect(orderLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: { in: ['PAID', 'DELIVERED'] },
                closedAt: { gte: expect.any(Date) }
            })
        }));
        expect(orderCount).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: [
                    { status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } },
                    { status: 'DELIVERED', closedAt: null }
                ]
            })
        }));
    });
});
