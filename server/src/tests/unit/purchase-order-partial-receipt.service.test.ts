import { describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { AuditLogService } from '../../services/audit-log.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { CostingService } from '../../services/costing.service';

type Item = {
    id: number;
    productId: number;
    quantity: number;
    receivedQuantity: number;
    cost: number;
    purchaseUnit: string | null;
    conversionFactor: number | null;
    baseQuantity: number | null;
    baseCost: number | null;
};

function makeItem(overrides: Partial<Item> = {}): Item {
    // 10 kg at 5/kg, stored in grams (factor 1000).
    return {
        id: 31,
        productId: 7,
        quantity: 10,
        receivedQuantity: 0,
        cost: 5,
        purchaseUnit: 'kg',
        conversionFactor: 1000,
        baseQuantity: 10000,
        baseCost: 0.005,
        ...overrides,
    };
}

function receiveTx(order: Record<string, unknown>, opts: { previousReceipt?: unknown; receiptCount?: number } = {}) {
    const orderUpdates: Array<Record<string, unknown>> = [];
    const itemUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
    const receiptCreates: Array<Record<string, unknown>> = [];
    const lineCreates: Array<Record<string, unknown>> = [];
    const tx = {
        $queryRaw: jest.fn(async () => []),
        purchaseOrder: {
            findFirst: jest.fn(async () => order),
            update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                orderUpdates.push(args.data);
                return {};
            }),
            findUnique: jest.fn(async () => ({ id: order.id, status: orderUpdates[orderUpdates.length - 1]?.status ?? order.status })),
        },
        purchaseOrderReceipt: {
            findFirst: jest.fn(async () => opts.previousReceipt ?? null),
            count: jest.fn(async () => opts.receiptCount ?? 0),
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                receiptCreates.push(args.data);
                return { id: 99, ...args.data };
            }),
            update: jest.fn(async () => ({})),
        },
        purchaseOrderReceiptLine: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                lineCreates.push(args.data);
                return {};
            }),
        },
        purchaseOrderItem: {
            update: jest.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
                itemUpdates.push(args);
                return {};
            }),
        },
        warehouse: { findFirst: jest.fn(async () => ({ branchId: 2 })) },
        stock: { aggregate: jest.fn(async () => ({ _sum: { quantity: 0 } })) },
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
    );
    const lockSpy = jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
    const movementSpy = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
        movementId: 501, balanceQty: 0, balanceCost: 0, unitCost: 0, totalCost: 0,
    });
    const costSpy = jest.spyOn(CostingService, 'updateProductCost').mockResolvedValue();
    jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
    return { tx, orderUpdates, itemUpdates, receiptCreates, lineCreates, lockSpy, movementSpy, costSpy };
}

const issuedOrder = (items: Item[], extra: Record<string, unknown> = {}) => ({
    id: 10,
    branchId: 2,
    status: 'ISSUED',
    invoiceType: 'CASH',
    total: 50,
    paidAmount: 50,
    items,
    ...extra,
});

describe('PurchaseOrderService partial receipts', () => {
    it('receives part of a line with its own reference, base-unit cost and FIFO layer', async () => {
        const ctx = receiveTx(issuedOrder([makeItem()]));

        const result = await PurchaseOrderService.receive(10, 1, 9, 4, {
            items: [{ itemId: 31, quantity: 4 }],
            idempotencyKey: 'key-1',
        });

        expect(ctx.lockSpy).toHaveBeenCalledWith(ctx.tx as never, 1, [4], [7], 'SHARE');
        expect(ctx.receiptCreates[0]).toEqual(expect.objectContaining({
            purchaseOrderId: 10, warehouseId: 4, sequence: 1, reference: 'PO-10-R1', idempotencyKey: 'key-1',
        }));
        expect(ctx.movementSpy).toHaveBeenCalledTimes(1);
        const movement = ctx.movementSpy.mock.calls[0][1];
        expect(movement).toEqual(expect.objectContaining({
            type: 'IN', warehouseId: 4, productId: 7, quantity: 4000,
            originalQuantity: 4, reference: 'PO-10-R1', sourceType: 'PURCHASE',
        }));
        // 4 kg x 5 = 20 spread over 4000 g, full precision.
        expect(movement.unitCost! * movement.quantity).toBeCloseTo(20, 10);
        expect(ctx.costSpy).toHaveBeenCalledWith(ctx.tx as never, 7, 1, 31, 4000, movement.unitCost as number, 4, 0);
        expect(ctx.lineCreates[0]).toEqual(expect.objectContaining({
            purchaseOrderItemId: 31, quantity: 4, baseQuantity: 4000, totalCost: 20, inventoryMovementId: 501,
        }));
        expect(ctx.itemUpdates).toEqual([{ where: { id: 31 }, data: { receivedQuantity: 4 } }]);
        // CASH settles only what arrived.
        expect(ctx.orderUpdates).toEqual([{
            status: 'PARTIALLY_RECEIVED', receivedTotal: 20, paidAmount: 20, paymentStatus: 'PAID',
        }]);
        expect(result.replayed).toBe(false);
    });

    it('completes the line with the exact base remainder and marks the order RECEIVED', async () => {
        const ctx = receiveTx(
            issuedOrder([makeItem({ receivedQuantity: 4 })], { status: 'PARTIALLY_RECEIVED', paidAmount: 20 }),
            { receiptCount: 1 }
        );

        await PurchaseOrderService.receive(10, 1, 9, 4, { idempotencyKey: 'key-2' });

        expect(ctx.receiptCreates[0]).toEqual(expect.objectContaining({ sequence: 2, reference: 'PO-10-R2' }));
        expect(ctx.movementSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
            quantity: 6000, originalQuantity: 6, reference: 'PO-10-R2',
        }));
        expect(ctx.itemUpdates).toEqual([{ where: { id: 31 }, data: { receivedQuantity: 10 } }]);
        expect(ctx.orderUpdates).toEqual([{
            status: 'RECEIVED', receivedTotal: 50, paidAmount: 50, paymentStatus: 'PAID',
        }]);
    });

    it('keeps CREDIT payments and re-evaluates the status against the received value', async () => {
        const ctx = receiveTx(issuedOrder([makeItem()], { invoiceType: 'CREDIT', paidAmount: 0 }));

        await PurchaseOrderService.receive(10, 1, 9, 4, { items: [{ itemId: 31, quantity: 2 }], idempotencyKey: 'k' });

        expect(ctx.orderUpdates).toEqual([{ status: 'PARTIALLY_RECEIVED', receivedTotal: 10, paymentStatus: 'PENDING' }]);
    });

    it('rejects an over-receipt without touching stock', async () => {
        const ctx = receiveTx(issuedOrder([makeItem({ receivedQuantity: 4 })], { status: 'PARTIALLY_RECEIVED' }));

        await expect(PurchaseOrderService.receive(10, 1, 9, 4, {
            items: [{ itemId: 31, quantity: 7 }],
            idempotencyKey: 'k',
        })).rejects.toThrow(/excede el saldo pendiente \(6\)/);

        expect(ctx.movementSpy).not.toHaveBeenCalled();
        expect(ctx.receiptCreates).toEqual([]);
    });

    it('rejects zero, negative, duplicate and foreign lines', async () => {
        receiveTx(issuedOrder([makeItem()]));

        await expect(PurchaseOrderService.receive(10, 1, 9, 4, { items: [{ itemId: 31, quantity: 0 }] }))
            .rejects.toThrow(/mayor a 0/);
        await expect(PurchaseOrderService.receive(10, 1, 9, 4, { items: [{ itemId: 31, quantity: -1 }] }))
            .rejects.toThrow(/mayor a 0/);
        await expect(PurchaseOrderService.receive(10, 1, 9, 4, {
            items: [{ itemId: 31, quantity: 1 }, { itemId: 31, quantity: 1 }],
        })).rejects.toThrow(/repetido/);
        await expect(PurchaseOrderService.receive(10, 1, 9, 4, { items: [{ itemId: 77, quantity: 1 }] }))
            .rejects.toThrow(/no pertenece/);
    });

    it('rejects a warehouse from another branch', async () => {
        const ctx = receiveTx(issuedOrder([makeItem()]));
        ctx.tx.warehouse.findFirst.mockResolvedValue({ branchId: 3 } as never);

        await expect(PurchaseOrderService.receive(10, 1, 9, 4, { idempotencyKey: 'k' }))
            .rejects.toThrow(/no pertenece a la sucursal/);
        expect(ctx.movementSpy).not.toHaveBeenCalled();
    });

    it('treats a replayed receipt key as a no-op, even after the order became RECEIVED', async () => {
        const ctx = receiveTx(
            issuedOrder([makeItem({ receivedQuantity: 10 })], { status: 'RECEIVED' }),
            { previousReceipt: { id: 99, warehouseId: 4 } }
        );

        const result = await PurchaseOrderService.receive(10, 1, 9, 4, { idempotencyKey: 'key-1' });

        expect(result.replayed).toBe(true);
        expect(ctx.movementSpy).not.toHaveBeenCalled();
        expect(ctx.receiptCreates).toEqual([]);
        expect(ctx.orderUpdates).toEqual([]);
        expect(ctx.tx.purchaseOrderReceipt.findFirst as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
            where: { purchaseOrderId: 10, idempotencyKey: 'key-1' },
        }));
    });

    it('closes the remaining balance without stock effect and adjusts the payable', async () => {
        const orderUpdates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => issuedOrder(
                    [makeItem({ receivedQuantity: 4 }), makeItem({ id: 32, productId: 8, quantity: 2, cost: 10, receivedQuantity: 0 })],
                    { status: 'PARTIALLY_RECEIVED', invoiceType: 'CREDIT', total: 70, paidAmount: 0 }
                )),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    orderUpdates.push(args.data);
                    return {};
                }),
                findUnique: jest.fn(async () => ({ id: 10 })),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const movementSpy = jest.spyOn(InventoryEngineService, 'applyMovement');
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await PurchaseOrderService.closeRemaining(10, 1, 9, 'Proveedor sin existencias');

        expect(movementSpy).not.toHaveBeenCalled();
        expect(orderUpdates).toEqual([expect.objectContaining({
            status: 'RECEIVED',
            total: 20,
            receivedTotal: 20,
            receivingClosedById: 9,
            receivingCloseReason: 'Proveedor sin existencias',
            paymentStatus: 'PENDING',
        })]);
        expect(AuditLogService.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'CLOSE_REMAINING',
            details: expect.objectContaining({
                orderedTotal: 70,
                abandoned: [
                    { itemId: 31, productId: 7, quantity: 6 },
                    { itemId: 32, productId: 8, quantity: 2 },
                ],
            }),
        }), tx as never);
    });

    it('refuses to close the balance of an order without receipts', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: { findFirst: jest.fn(async () => issuedOrder([makeItem()])), update: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.closeRemaining(10, 1, 9, 'x')).rejects.toThrow(/cancélela/);
        await expect(PurchaseOrderService.closeRemaining(10, 1, 9, '  ')).rejects.toThrow(/motivo/);
        expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('blocks cancelling a partially received order through a plain status edit', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'PARTIALLY_RECEIVED' })),
                update: jest.fn(),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.update(10, 1, { status: 'CANCELLED' }))
            .rejects.toThrow(/Revertir recepción/);
        expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('caps credit payments of a partially received order at the received value', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
            id: 10, invoiceType: 'CREDIT', status: 'PARTIALLY_RECEIVED', paidAmount: 0, total: 100, receivedTotal: 40,
        } as never);

        await expect(PurchaseOrderService.addPayment(10, 1, { amount: 41 }))
            .rejects.toThrow(/Saldo: 40\.00/);
    });
});

describe('PurchaseOrderService reverse receipt after partial receipts', () => {
    function reverseTx(
        batches: Array<Record<string, unknown>>,
        movements: Array<Record<string, unknown>>
    ) {
        const orderUpdates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({
                    id: 10,
                    status: 'PARTIALLY_RECEIVED',
                    items: [{ id: 31 }, { id: 32 }],
                })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    orderUpdates.push(args.data);
                    return { id: 10, ...args.data };
                }),
            },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 2 })) },
            purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 2 })) },
            inventoryBatch: { findMany: jest.fn(async () => batches) },
            inventoryMovement: { findMany: jest.fn(async () => movements) },
            product: { findFirst: jest.fn(async ({ where }: { where: { id: number } }) => ({ name: `P${where.id}` })) },
            // Stock after the layer leg: nothing left to cover the shortfall.
            stock: { findUnique: jest.fn(async () => ({ quantity: 0 })) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        const movementSpy = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 1, balanceQty: 0, balanceCost: 0, unitCost: 0, totalCost: 0,
        });
        const costSpy = jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
        return { tx, orderUpdates, movementSpy, costSpy };
    }

    it('reverses each receipt against its own layers and warehouse, then cancels', async () => {
        const ctx = reverseTx(
            [
                { warehouseId: 4, productId: 7, originalQty: 4000, sourceRef: 'PO-10-R1' },
                { warehouseId: 5, productId: 7, originalQty: 1000, sourceRef: 'PO-10-R2' },
            ],
            [
                { warehouseId: 4, productId: 7, quantity: 4000, unitCost: 0.005, totalCost: 20, reference: 'PO-10-R1' },
                { warehouseId: 5, productId: 7, quantity: 1000, unitCost: 0.005, totalCost: 5, reference: 'PO-10-R2' },
            ]
        );

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Mercadería devuelta');

        expect(ctx.movementSpy).toHaveBeenCalledTimes(2);
        expect(ctx.movementSpy).toHaveBeenNthCalledWith(1, ctx.tx as never, expect.objectContaining({
            type: 'OUT', warehouseId: 4, productId: 7, quantity: 4000,
            reference: 'PO-10-R1', consumeSourceRef: 'PO-10-R1', valueFromConsumedLayers: true,
        }));
        expect(ctx.movementSpy).toHaveBeenNthCalledWith(2, ctx.tx as never, expect.objectContaining({
            warehouseId: 5, quantity: 1000, consumeSourceRef: 'PO-10-R2',
        }));
        expect(ctx.costSpy).toHaveBeenCalledWith(ctx.tx as never, [31, 32], 1);
        expect(ctx.tx.purchaseOrderItem.updateMany as jest.Mock).toHaveBeenCalledWith({
            where: { purchaseOrderId: 10 }, data: { receivedQuantity: 0 },
        });
        expect(ctx.orderUpdates).toEqual([{
            status: 'CANCELLED', paidAmount: 0, paymentStatus: 'PENDING', receivedTotal: 0,
        }]);
    });

    it('refuses with a clear message when a receipt layer was already consumed', async () => {
        const ctx = reverseTx(
            [{ warehouseId: 4, productId: 7, originalQty: 4000, sourceRef: 'PO-10-R1' }],
            [{ warehouseId: 4, productId: 7, quantity: 4000, unitCost: 0.005, totalCost: 20, reference: 'PO-10-R1' }]
        );
        ctx.movementSpy.mockRejectedValue(new Error(
            'No hay cantidad suficiente en las capas del movimiento PO-10-R1 para una reversa exacta. Requerido: 4000, Disponible en lote: 1500'
        ));

        await expect(PurchaseOrderService.reverseReceipt(10, 1, 9, 'Devolución'))
            .rejects.toThrow(/No se puede revertir la recepción PO-10-R1 de "P7".*ya fue consumido/);
        expect(ctx.orderUpdates).toEqual([]);
    });

    it('restores the original negative balance when the receipt covered a shortfall', async () => {
        // Stock -20, receive 100 at 5: the engine covered the 20 deficit and
        // opened a layer of 80. The reversal must take out all 100.
        const ctx = reverseTx(
            [{ warehouseId: 4, productId: 7, originalQty: 80, sourceRef: 'PO-10-R1' }],
            [{ warehouseId: 4, productId: 7, quantity: 100, unitCost: 5, totalCost: 500, reference: 'PO-10-R1' }]
        );

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Error de digitación');

        expect(ctx.movementSpy).toHaveBeenCalledTimes(2);
        expect(ctx.movementSpy).toHaveBeenNthCalledWith(1, ctx.tx as never, expect.objectContaining({
            type: 'OUT', quantity: 80, consumeSourceRef: 'PO-10-R1', valueFromConsumedLayers: true,
        }));
        const shortfall = ctx.movementSpy.mock.calls[1][1];
        expect(shortfall).toEqual(expect.objectContaining({
            type: 'OUT', quantity: 20, allowNegative: true, unitCost: 5, reference: 'PO-10-R1',
        }));
        expect(shortfall.consumeSourceRef).toBeUndefined();
    });

    it('applies the same full-quantity rule to legacy single-shot receipts', async () => {
        const ctx = reverseTx(
            [],
            [{ warehouseId: 4, productId: 8, quantity: 30, unitCost: 2, totalCost: 60, reference: 'PO-10' }]
        );

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Recepción sobre stock negativo');

        // No layer survived (the whole entry covered a deficit): only the
        // allowNegative leg runs.
        expect(ctx.movementSpy).toHaveBeenCalledTimes(1);
        expect(ctx.movementSpy).toHaveBeenCalledWith(ctx.tx as never, expect.objectContaining({
            quantity: 30, allowNegative: true, unitCost: 2, reference: 'PO-10',
        }));
    });
});
