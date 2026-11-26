import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PedidosYaService } from '../../services/pedidosya.service';
import { KitchenNotificationService } from '../../services/kitchen-notification.service';
import { CostingService } from '../../services/costing.service';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { AuditLogService } from '../../services/audit-log.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PedidosYa auto-accepted orders', () => {
    it('persists the first kitchen batch and links every item to it', async () => {
        jest.spyOn(prisma.pedidosYaWebhookLog, 'create').mockResolvedValue({ id: 30 } as never);
        jest.spyOn(prisma.pedidosYaWebhookLog, 'update').mockResolvedValue({} as never);
        jest.spyOn(prisma.pedidosYaOrderSync, 'findFirst').mockResolvedValue(null);
        jest.spyOn(prisma.pedidosYaConfig, 'findMany').mockResolvedValue([{
            id: 2, companyId: 1, branchId: 3, active: true, autoAcceptOrders: true
        }] as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 3 } as never);
        jest.spyOn(prisma.salesChannelConfig, 'findUnique').mockResolvedValue(null);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 7 } as never);
        jest.spyOn(
            PedidosYaService as unknown as { mapOrderItems: (...args: unknown[]) => Promise<unknown> },
            'mapOrderItems'
        ).mockResolvedValue({ mapped: [{ menuItemId: 11, quantity: 2, price: 5 }], unmapped: [] });
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        const tx = {
            pedidosYaOrderSync: {
                findUnique: jest.fn(async () => null),
                create: jest.fn(async () => ({ id: 1 })),
            },
            order: { create: jest.fn(async () => ({ id: 50 })) },
            kitchenBatch: { create: jest.fn(async (_args: unknown) => ({ id: 70 })) },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PedidosYaService.processWebhook(1, 'NEW_ORDER', {
            id: 'PY-AUTO', items: [{ id: 'e1', name: 'Combo', quantity: 2, price: 5 }]
        });

        expect(tx.kitchenBatch.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                companyId: 1, branchId: 3, orderId: 50, sequence: 1, status: 'PENDING',
            }),
        });
        expect(tx.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ orderId: 50 }),
            data: { kitchenBatchId: 70 },
        }));
    });

    it('never lets a mapping body override the tenant', async () => {
        jest.spyOn(prisma.pedidosYaProductMapping, 'findFirst').mockResolvedValue(null);
        const create = jest.spyOn(prisma.pedidosYaProductMapping, 'create').mockResolvedValue({} as never);

        await PedidosYaService.upsertMapping(1, {
            externalId: 'X1', externalName: 'Combo', companyId: 99, id: 5,
        } as never);

        const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.companyId).toBe(1);
        expect(data).not.toHaveProperty('id');
    });
});

describe('KitchenNotificationService.reconcileReadyForUser', () => {
    it('only replays live orders with a persisted readyAt and tolerates one failure', async () => {
        const findMany = jest.spyOn(prisma.kitchenBatch, 'findMany').mockResolvedValue([
            { id: 1, orderId: 10 }, { id: 2, orderId: 11 },
        ] as never);
        const notify = jest.spyOn(KitchenNotificationService, 'notifyReady')
            .mockRejectedValueOnce(new Error('sin timestamp'))
            .mockResolvedValueOnce({} as never);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(KitchenNotificationService.reconcileReadyForUser(1, 7)).resolves.toBeUndefined();

        const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; take?: number };
        expect(args.where).toEqual(expect.objectContaining({
            readyAt: { not: null },
            order: { userId: 7, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
        }));
        expect(args.take).toBeGreaterThan(0);
        expect(notify).toHaveBeenCalledTimes(2);
    });
});

describe('CostingService.calculateWeightedAverageCost with negative stock', () => {
    it('uses the entry cost when prior stock is negative', async () => {
        await expect(CostingService.calculateWeightedAverageCost(1, -5, 10, 5, 7)).resolves.toBe(7);
        await expect(CostingService.calculateWeightedAverageCost(1, -2, 10, 5, 7)).resolves.toBe(7);
    });
});

describe('PurchaseOrderService.update allowlist', () => {
    it('drops tenant, totals and settlement fields from the update payload', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 4, status: 'DRAFT', invoiceType: 'CREDIT', total: 100 })),
                update: jest.fn(async () => ({ id: 4 })),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PurchaseOrderService.update(4, 1, {
            notes: 'ok', companyId: 99, total: 1, paidAmount: 100, paymentStatus: 'PAID', items: [],
        } as never);

        const data = (tx.purchaseOrder.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
        expect(data).toEqual({ notes: 'ok' });
    });
});

describe('PurchaseOrderService.reverseReceipt layer selection', () => {
    it('excludes layers recreated by consumption reversals', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'RECEIVED', items: [{ id: 31 }] })),
                update: jest.fn(async () => ({ id: 10 })),
            },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
            purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 0 })) },
            inventoryMovement: { findMany: jest.fn(async () => []) },
            inventoryBatch: {
                findMany: jest.fn(async () => [{ warehouseId: 4, productId: 7, originalQty: 10 }]),
            },
            product: { findFirst: jest.fn(async () => ({ name: 'P7' })) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({} as never);
        jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Corrección');

        const where = (tx.inventoryBatch.findMany.mock.calls[0] as unknown as [{ where: { AND: Array<{ OR: unknown[] }> } }])[0].where;
        // Partial receipts: the provenance filter sits next to the receipt
        // reference filter (legacy PO-{id} or per-receipt PO-{id}-R{n}).
        expect(where.AND.flatMap((clause) => clause.OR)).toEqual(expect.arrayContaining([
            { sourceMovement: { origin: { not: 'REVERSAL' } } },
            { sourceRef: 'PO-10' },
            { sourceRef: { startsWith: 'PO-10-R' } },
        ]));
    });
});
