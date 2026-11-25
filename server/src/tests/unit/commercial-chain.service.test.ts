import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';

import prisma from '../../utils/prisma';
import { validate } from '../../middlewares/validate';
import { addOrderItem } from '../../middlewares/validate-schemas';
import { OrderService } from '../../services/order.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { PedidosYaService } from '../../services/pedidosya.service';
import { calculatePromotionDiscount } from '../../services/promotion.service';
import { ReservationService } from '../../services/reservation.service';
import { BranchService } from '../../services/branch.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('commercial chain request and pricing invariants', () => {
    it('rejects empty and invalid branch mutations at the service boundary', async () => {
        await expect(BranchService.update(2, 1, { name: '   ' }, 9)).rejects.toThrow(/nombre/i);
        await expect(BranchService.update(2, 1, { status: 'DELETED' as never }, 9)).rejects.toThrow(/estado/i);
        await expect(BranchService.update(2, 1, {}, 9)).rejects.toThrow(/campos válidos/i);
    });

    it('rejects fractional POS quantities at the HTTP contract', () => {
        const req = { params: { id: '9' }, body: { menuItemId: 4, quantity: 1.5 } } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validate(addOrderItem)(req, { status, json } as unknown as ExpressResponse, next);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            errors: expect.arrayContaining([expect.objectContaining({ field: 'body.quantity' })])
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects fractional POS quantities again at the service boundary', async () => {
        await expect(OrderService.addItem(1, 1, { menuItemId: 2, quantity: 0.5 }))
            .rejects.toThrow(/positive integer/i);
    });

    it('blocks selling an existing active PREPARED item whose sale BOM is empty', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    branchId: 2,
                    status: 'OPEN',
                    invoiceNumber: null,
                    payments: []
                }))
            },
            menuItem: {
                findFirst: jest.fn(async () => ({
                    id: 4,
                    name: 'Pasta sin receta',
                    type: 'PREPARED',
                    active: true,
                    _count: { recipes: 0 },
                    modifierGroups: []
                }))
            },
            orderItem: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(OrderService.addItem(8, 1, { menuItemId: 4, quantity: 1 }))
            .rejects.toThrow(/bloqueado.*BOM/i);
        expect(tx.orderItem.create).not.toHaveBeenCalled();
    });

    it('uses one capped, rounded promotion calculation for percentage discounts', () => {
        const promotion = {
            active: true,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            validTo: new Date('2026-12-31T23:59:59Z'),
            usageLimit: 20,
            usageCount: 2,
            minOrderAmount: 10,
            type: 'PERCENTAGE' as const,
            value: 25,
            maxDiscount: 12.34
        };

        expect(calculatePromotionDiscount(promotion as never, 100, new Date('2026-07-13T12:00:00Z'))).toBe(12.34);
    });

    it('fails promotion repricing once the minimum is no longer met', () => {
        const promotion = {
            active: true,
            validFrom: new Date('2026-01-01T00:00:00Z'),
            validTo: null,
            usageLimit: null,
            usageCount: 0,
            minOrderAmount: 50,
            type: 'FIXED_AMOUNT' as const,
            value: 5,
            maxDiscount: null
        };

        expect(() => calculatePromotionDiscount(promotion as never, 49))
            .toThrow('MINIMUM_NOT_MET');
    });
});

describe('kitchen order state invariants', () => {
    it('does not settle a consumed zero-total order created with a manual discount', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    branchId: 2,
                    status: 'READY',
                    financialStatus: 'UNPAID',
                    total: 0,
                    discount: 10,
                    discountCode: null,
                    tax: 0,
                    tipAmount: 0,
                    items: [{ id: 2, subtotal: 10, sentAt: new Date(), menuItem: { recipes: [] } }],
                    table: null
                }))
            }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.complete(8, 1, 3, 4)).rejects.toThrow(/promoción válida/i);
    });

    it('cannot mark READY while an item has never been sent to kitchen', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    status: 'SENT_TO_KITCHEN',
                    items: [{ id: 2, sentAt: null, status: 'PENDING' }]
                })),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 4 })) },
            orderItem: { updateMany: jest.fn() },
            auditLog: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.updateStatus(8, 1, 'READY', 4)).rejects.toThrow(/sin enviar a cocina/i);
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('reopens after a sent wave finishes while unsent lines remain on the ticket', async () => {
        const sentAt = new Date('2026-07-16T12:00:00.000Z');
        const items = [
            { id: 21, sentAt, status: 'IN_PROGRESS', startedAt: sentAt, menuItem: { id: 1 }, modifiers: [] },
            { id: 22, sentAt: null, status: 'PENDING', startedAt: null, menuItem: { id: 2 }, modifiers: [] }
        ];
        const afterFinish = [
            { ...items[0], status: 'DONE', finishedAt: new Date() },
            items[1]
        ];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ id: 8, companyId: 1, status: 'IN_PREPARATION' })),
                findUnique: jest.fn(async () => ({
                    id: 8,
                    companyId: 1,
                    branchId: 2,
                    status: 'IN_PREPARATION',
                    salesChannel: 'RESTAURANT',
                    table: null,
                    user: { id: 7, name: 'Chef', color: null },
                    items: afterFinish
                })),
                update: jest.fn(async (args: { data: { status: string } }) => ({
                    id: 8,
                    companyId: 1,
                    branchId: 2,
                    status: args.data.status,
                    salesChannel: 'RESTAURANT',
                    table: null,
                    user: { id: 7, name: 'Chef', color: null },
                    items: afterFinish
                }))
            },
            orderItem: {
                updateMany: jest.fn(async () => ({ count: 1 })),
                findUnique: jest.fn(async () => afterFinish[0])
            }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.finishItem(8, 21, 1);

        expect(result.allDone).toBe(false);
        expect(result.order.status).toBe('OPEN');
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { status: 'OPEN' }
        }));
    });

    it('rejects delivery while unsent products remain on a READY order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    companyId: 1,
                    branchId: 2,
                    status: 'READY',
                    financialStatus: 'PAID',
                    total: 10,
                    discount: 0,
                    discountCode: null,
                    tax: 0,
                    tipAmount: 0,
                    closedAt: null,
                    items: [
                        { id: 21, sentAt: new Date(), subtotal: 10, menuItem: { recipes: [] } },
                        { id: 22, sentAt: null, subtotal: 0, menuItem: { recipes: [] } }
                    ],
                    table: null
                })),
                update: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.complete(8, 1, 3, 4)).rejects.toThrow(/sin enviar a cocina/i);
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('rejects READY through the generic status boundary without a kitchen actor', async () => {
        await expect(OrderService.updateStatus(8, 1, 'READY')).rejects.toThrow(/flujo dedicado de cocina/i);
    });

    it('makes a dedicated READY retry idempotent for notification recovery', async () => {
        const ready = {
            id: 8,
            status: 'READY',
            salesChannel: 'RESTAURANT',
            items: [{ id: 10, sentAt: new Date(), status: 'DONE' }]
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ready),
                findUnique: jest.fn(async () => ready),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 4 })) },
            auditLog: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.updateStatus(8, 1, 'READY', 4);

        expect(result.status).toBe('READY');
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('send-to-kitchen stamps only unsent items and derives SENT_TO_KITCHEN', async () => {
        const sentAt = new Date();
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    status: 'OPEN',
                    items: [{ id: 2, sentAt: null, status: 'PENDING' }]
                })),
                findUnique: jest.fn(async () => ({
                    id: 8,
                    status: 'OPEN',
                    salesChannel: 'RESTAURANT',
                    items: [{ id: 2, sentAt, status: 'PENDING' }]
                })),
                update: jest.fn(async (args: { data: { status: string } }) => ({
                    id: 8,
                    status: args.data.status,
                    items: [{ id: 2, sentAt, status: 'PENDING' }]
                }))
            },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(8, 1);

        expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
            where: { orderId: 8, sentAt: null },
            data: { sentAt: expect.any(Date) }
        });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SENT_TO_KITCHEN' } }));
        expect(result).toEqual(expect.objectContaining({ status: 'SENT_TO_KITCHEN' }));
    });

    it('self-heals a legacy READY order with an unsent line by reopening its KDS cycle', async () => {
        const sentAt = new Date();
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    status: 'READY',
                    kitchenReleasedAt: new Date(),
                    items: [
                        { id: 1, sentAt, status: 'DONE' },
                        { id: 2, sentAt: null, status: 'PENDING' }
                    ]
                })),
                findUnique: jest.fn(async () => ({
                    id: 8,
                    status: 'READY',
                    salesChannel: 'RESTAURANT',
                    items: [
                        { id: 1, sentAt, status: 'DONE' },
                        { id: 2, sentAt, status: 'PENDING' }
                    ]
                })),
                update: jest.fn(async (args: { data: { status: string } }) => ({
                    id: 8,
                    status: args.data.status,
                    salesChannel: 'RESTAURANT',
                    items: [
                        { id: 1, sentAt, status: 'DONE' },
                        { id: 2, sentAt, status: 'PENDING' }
                    ]
                }))
            },
            orderItem: { updateMany: jest.fn(async () => ({ count: 1 })) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(8, 1);

        expect(result.status).toBe('SENT_TO_KITCHEN');
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'SENT_TO_KITCHEN',
                kitchenReleasedAt: null,
                kitchenStartedAt: null
            })
        }));
    });

    it('records all legacy READY lines as waste when item sentAt timestamps are missing', async () => {
        const legacyItems = [
            { id: 21, quantity: 2, sentAt: null, menuItem: { recipes: [] } },
            { id: 22, quantity: 1, sentAt: null, menuItem: { recipes: [] } }
        ];
        const order = {
            id: 8,
            companyId: 1,
            branchId: 2,
            userId: 7,
            status: 'READY',
            financialStatus: 'UNPAID',
            invoiceNumber: null,
            payments: [],
            items: legacyItems,
            tableId: null,
            closedAt: null,
            discountCode: null
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => order),
                update: jest.fn(async (_args: unknown) => ({ ...order, status: 'CANCELLED' }))
            },
            warehouse: { findFirst: jest.fn(async () => ({ id: 5 })) },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);
        const consume = jest.spyOn(InventoryConsumptionService, 'consumeForOrder')
            .mockResolvedValue({ consumed: true });
        const reverse = jest.spyOn(InventoryConsumptionService, 'reverseForOrder');

        await OrderService.cancel(8, 1, 9, 'Producto preparado cancelado', { wasteWarehouseId: 5 });

        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            order: expect.objectContaining({ items: legacyItems }),
            orderItemIds: [21, 22],
            warehouseId: 5,
            reference: 'WASTE-ORD-8'
        }));
        expect(reverse).not.toHaveBeenCalled();
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'CANCELLED' })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                details: expect.objectContaining({ wastedItemIds: [21, 22], wasteWarehouseId: 5 })
            })
        }));
    });
});

describe('atomic reservation check-in', () => {
    it('creates the linked POS order, completes the reservation and occupies the table atomically', async () => {
        const reservation = {
            id: 12,
            companyId: 1,
            branchId: 2,
            tableId: 3,
            customerName: 'Ana',
            status: 'CONFIRMED',
            date: new Date(),
            table: { id: 3, status: 'AVAILABLE' }
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            reservation: {
                findFirst: jest.fn(async () => reservation),
                update: jest.fn(async (_args: unknown) => ({ ...reservation, status: 'COMPLETED' }))
            },
            order: {
                findUnique: jest.fn(async () => null),
                findFirst: jest.fn(async () => null),
                create: jest.fn(async (_args: unknown) => ({ id: 30, reservationId: 12, tableId: 3, branchId: 2 }))
            },
            table: {
                findFirst: jest.fn(async () => reservation.table),
                update: jest.fn(async (_args: unknown) => ({ ...reservation.table, status: 'OCCUPIED' }))
            },
            branch: { findFirst: jest.fn(async () => ({ id: 2 })) },
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            setting: { findUnique: jest.fn(async () => ({ value: '120' })) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await ReservationService.checkIn(12, 1, 9);

        expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ reservationId: 12, tableId: 3, userId: 9, status: 'OPEN' })
        }));
        expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }));
        expect(tx.table.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'OCCUPIED' } });
        expect(result.order).toEqual(expect.objectContaining({ reservationId: 12 }));
    });

    it('does not allow generic CONFIRMED to COMPLETED without creating an order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            reservation: {
                findFirst: jest.fn(async () => ({ id: 12, status: 'CONFIRMED' })),
                update: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(ReservationService.updateStatus(12, 1, 'COMPLETED')).rejects.toThrow(/inválida/i);
        expect(tx.reservation.update).not.toHaveBeenCalled();
    });
});

describe('PedidosYa fail-closed synchronization', () => {
    it('persists FAILED outbound status when the platform rejects a status update', async () => {
        jest.spyOn(prisma.pedidosYaOrderSync, 'findFirst').mockResolvedValue({
            id: 5,
            companyId: 1,
            orderId: 8,
            externalId: 'PY-8',
            metadata: { source: 'webhook' },
            order: { branchId: 2 }
        } as never);
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst').mockResolvedValue({
            id: 3,
            branchId: 2,
            autoSyncStatus: true,
            environment: 'sandbox'
        } as never);
        const update = jest.spyOn(prisma.pedidosYaOrderSync, 'update').mockResolvedValue({} as never);
        jest.spyOn(PedidosYaService, 'getValidToken').mockResolvedValue('token');
        jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as unknown as globalThis.Response);

        await expect(PedidosYaService.syncOrderStatus(1, 8, 'READY')).rejects.toThrow(/503/);

        expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
            data: expect.objectContaining({
                internalStatus: 'READY',
                syncDirection: 'OUTBOUND',
                metadata: expect.objectContaining({ outboundSync: expect.objectContaining({ status: 'PENDING' }) })
            })
        }));
        expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
            data: expect.objectContaining({
                metadata: expect.objectContaining({ outboundSync: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('503') }) })
            })
        }));
    });

    it('does not report a fake menu sync success', async () => {
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst').mockResolvedValue({ id: 3, active: true } as never);
        const configUpdate = jest.spyOn(prisma.pedidosYaConfig, 'update');

        await expect(PedidosYaService.syncMenu(1)).rejects.toThrow(/no está implementada/i);
        expect(configUpdate).not.toHaveBeenCalled();
    });
});
