import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { SaleWarehouseService } from '../../services/sale-warehouse.service';

afterEach(() => {
    jest.restoreAllMocks();
});

type Row = Record<string, unknown>;

/**
 * Order #41: line #10 is 3 x 12.50 (sent, batch #7 IN_PREPARATION) and line
 * #11 is 1 x 20.00. Company tax 15 %, tip rate 10 %, stored tip 5.75.
 */
function voidTx(options: {
    order?: Row;
    item?: Row | null;
    replay?: Row | null;
    remainingSubtotals?: number[];
    liveLinesInBatch?: number;
    batchStatus?: string;
    promotion?: Row | null;
    discountAuthorRole?: string;
    maxManualDiscountPercent?: string;
} = {}) {
    const order = {
        id: 41,
        companyId: 1,
        branchId: 3,
        userId: 5,
        status: 'IN_PREPARATION',
        salesChannel: 'RESTAURANT',
        financialStatus: 'UNPAID',
        invoiceNumber: null,
        preInvoicedAt: null,
        discount: 0,
        discountCode: null,
        tax: 8.63,
        tipAmount: 5.75,
        total: 71.88,
        payments: [],
        ...options.order
    };
    const item = options.item === undefined ? {
        id: 10,
        orderId: 41,
        menuItemId: 3,
        kitchenBatchId: 7,
        quantity: 3,
        price: 12.5,
        subtotal: 37.5,
        notes: null,
        status: 'IN_PROGRESS',
        sentAt: new Date('2026-11-18T12:00:00Z'),
        startedAt: new Date('2026-11-18T12:01:00Z'),
        finishedAt: null,
        originOrderId: null,
        originTableId: null,
        voidedAt: null,
        modifiers: [{ id: 1, modifierId: 9, name: 'Extra queso', price: 1 }],
        menuItem: { id: 3, name: 'Hamburguesa', recipes: [] }
    } : options.item;
    const orderItemFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(options.replay ?? null)
        .mockResolvedValueOnce(item);
    const orderFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(order)
        .mockResolvedValue({ ...order, items: [] });
    return {
        $queryRaw: jest.fn(async () => []),
        order: {
            findFirst: orderFindFirst,
            findUnique: jest.fn(async () => ({
                id: 41,
                status: order.status,
                kitchenReleasedAt: null,
                items: [],
                kitchenBatches: [{ status: options.batchStatus ?? 'READY', startedAt: null, startedById: null, releasedAt: null, releasedById: null }]
            })),
            update: jest.fn(async (args: unknown) => args)
        },
        orderItem: {
            findFirst: orderItemFindFirst,
            update: jest.fn(async (args: unknown) => args),
            create: jest.fn(async (_args: unknown) => ({ id: 99 })),
            count: jest.fn(async () => options.liveLinesInBatch ?? 1),
            findMany: jest.fn(async () => (options.remainingSubtotals ?? [12.5, 20]).map((subtotal) => ({ subtotal })))
        },
        kitchenBatch: {
            findFirst: jest.fn(async () => ({
                id: 7, status: options.batchStatus ?? 'IN_PREPARATION', startedAt: null, startedById: null
            })),
            update: jest.fn(async (args: unknown) => args),
            count: jest.fn(async () => 1)
        },
        warehouse: { findFirst: jest.fn(async () => ({ id: 4 })) },
        promotion: { findFirst: jest.fn(async () => options.promotion ?? null) },
        setting: {
            findMany: jest.fn(async () => [{ name: '1_tax_rate', value: '15' }]),
            findUnique: jest.fn(async (args: { where: { companyId_name: { name: string } } }) => (
                args.where.companyId_name.name.endsWith('_maxManualDiscountPercent')
                    ? { value: options.maxManualDiscountPercent ?? '100' }
                    : { value: '10' }
            ))
        },
        user: {
            findFirst: jest.fn(async () => ({ role: { name: options.discountAuthorRole ?? 'ADMIN' }, userRoles: [] }))
        },
        auditLog: {
            create: jest.fn(async (_args: unknown) => ({})),
            findFirst: jest.fn(async () => ({ userId: 6 }))
        }
    };
}

function useTx(tx: ReturnType<typeof voidTx>) {
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
    );
    const consume = jest.spyOn(InventoryConsumptionService, 'consumeForOrder')
        .mockResolvedValue({ consumed: true, negativeProductIds: [] });
    jest.spyOn(SaleWarehouseService, 'resolve').mockResolvedValue({ warehouseId: 4, source: 'DEFAULT' });
    return consume;
}

const baseInput = { reason: 'Cliente cambió de opinión', idempotencyKey: 'void-41-10-attempt' };

beforeEach(() => {
    // The preflight table read runs outside the tx (global client): keep it offline.
    jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(null);
});

describe('OrderService.voidKitchenItem', () => {
    it('voids 2 of 3 units: splits the line, wastes only 2 units and reprices 57.50 -> 32.50', async () => {
        const tx = voidTx();
        const consume = useTx(tx);

        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        // Original line keeps 1 x 12.50; the 2 voided units become row #99.
        expect(tx.orderItem.update).toHaveBeenNthCalledWith(1, {
            where: { id: 10 },
            data: { quantity: 1, subtotal: 12.5 }
        });
        expect(tx.orderItem.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                orderId: 41, kitchenBatchId: 7, quantity: 2, subtotal: 25, voidedFromItemId: 10,
                modifiers: { create: [{ modifierId: 9, name: 'Extra queso', price: 1 }] }
            })
        }));
        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            reference: 'WASTE-ORD-41-L99',
            orderItemIds: [99],
            warehouseId: 4,
            userId: 8,
            allowNegative: true,
            order: expect.objectContaining({ items: [expect.objectContaining({ id: 99, quantity: 2 })] })
        }));
        expect(tx.orderItem.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: { id: 99 },
            data: expect.objectContaining({
                quantity: 0, subtotal: 0, voidedQuantity: 2, voidedById: 8,
                voidReason: 'Cliente cambió de opinión', voidWasteReference: 'WASTE-ORD-41-L99',
                voidIdempotencyKey: 'void-41-10-attempt', status: 'DONE'
            })
        }));
        // 32.50 subtotal, tax 15 % = 4.875 -> 4.88, tip capped 5.75 -> 10 % x 32.50 = 3.25.
        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 40.63, discount: 0, discountCode: null, tax: 4.88, tipAmount: 3.25 }
        });
        expect(tx.kitchenBatch.update).not.toHaveBeenCalled();
        expect(tx.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KITCHEN_LINE_VOID',
                entityId: 41,
                userId: 8,
                details: expect.objectContaining({
                    orderItemId: 10, voidLineId: 99, voidedQuantity: 2, remainingQuantity: 1,
                    wasteReference: 'WASTE-ORD-41-L99',
                    previous: expect.objectContaining({ total: 71.88 }),
                    repriced: expect.objectContaining({ subtotal: 32.5, total: 40.63 })
                })
            })
        });
        expect(result).toEqual(expect.objectContaining({ replayed: false, voidItemId: 99, voidedQuantity: 2 }));
    });

    it('a full void of the last live line keeps the row, readies its batch so the KDS can release it', async () => {
        const tx = voidTx({
            item: {
                id: 10, orderId: 41, menuItemId: 3, kitchenBatchId: 7, quantity: 1, price: 20, subtotal: 20,
                notes: null, status: 'PENDING', sentAt: new Date(), startedAt: null, finishedAt: null,
                originOrderId: null, originTableId: null, voidedAt: null, modifiers: [],
                menuItem: { id: 3, recipes: [] }
            },
            batchStatus: 'PENDING',
            liveLinesInBatch: 0,
            remainingSubtotals: [0],
            order: { status: 'SENT_TO_KITCHEN', tax: 3, tipAmount: 0, total: 23 }
        });
        const consume = useTx(tx);

        await OrderService.voidKitchenItem(41, 10, 1, 8, baseInput);

        expect(tx.orderItem.create).not.toHaveBeenCalled();
        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({ reference: 'WASTE-ORD-41-L10', orderItemIds: [10] }));
        expect(tx.kitchenBatch.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7 },
            data: expect.objectContaining({ status: 'READY' })
        }));
        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 0, discount: 0, discountCode: null, tax: 0, tipAmount: 0 }
        });
    });

    it('drops a promotion whose minimum is no longer met instead of keeping a stale discount', async () => {
        const tx = voidTx({
            order: { discountCode: 'MIN50', discount: 5.75 },
            promotion: {
                active: true, validFrom: new Date('2026-01-01'), validTo: null, usageLimit: null, usageCount: 0,
                minOrderAmount: 50, type: 'PERCENTAGE', value: 10, maxDiscount: null
            }
        });
        useTx(tx);

        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 40.63, discount: 0, discountCode: null, tax: 4.88, tipAmount: 3.25 }
        });
        expect(result.promotionRemoved).toEqual({ code: 'MIN50', reason: expect.any(String) });
    });

    it('keeps a still-valid promotion and reprices it on the new subtotal (10 % of 32.50 = 3.25)', async () => {
        const tx = voidTx({
            order: { discountCode: 'PROMO10', discount: 5.75 },
            promotion: {
                active: true, validFrom: new Date('2026-01-01'), validTo: null, usageLimit: null, usageCount: 0,
                minOrderAmount: null, type: 'PERCENTAGE', value: 10, maxDiscount: null
            }
        });
        useTx(tx);

        await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        // net 29.25, tax 4.39 (4.3875), tip 10 % x 29.25 = 2.93 (2.925), total 36.57.
        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 36.57, discount: 3.25, discountCode: 'PROMO10', tax: 4.39, tipAmount: 2.93 }
        });
    });

    it.each([
        [{ preInvoicedAt: new Date() }, /revierta la prefactura/i],
        [{ invoiceNumber: 'FAC-1' }, /nota de crédito/i],
        [{ payments: [{ id: 3 }] }, /revierta los pagos/i],
        [{ status: 'DELIVERED' }, /entregada/i],
        [{ status: 'CANCELLED' }, /cancelada/i]
    ])('refuses %o without waste or repricing', async (orderPatch, message) => {
        const tx = voidTx({ order: orderPatch });
        const consume = useTx(tx);

        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, baseInput)).rejects.toThrow(message);
        expect(consume).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('refuses unsent lines, over-quantity and a missing reason', async () => {
        const unsent = voidTx({
            item: { id: 10, quantity: 1, sentAt: null, voidedAt: null, modifiers: [], menuItem: { recipes: [] } }
        });
        useTx(unsent);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, baseInput)).rejects.toThrow(/elimínela/i);

        jest.restoreAllMocks();
        const tooMany = voidTx();
        useTx(tooMany);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 4 })).rejects.toThrow(/Solo hay 3/);

        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, reason: ' ' })).rejects.toThrow(/motivo/i);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, { reason: 'Error', idempotencyKey: 'x' })).rejects.toThrow(/idempotente/i);
    });

    it('replays a retried request with the same key without wasting again', async () => {
        const tx = voidTx({ replay: { id: 99, orderId: 41, voidedFromItemId: 10, voidedQuantity: 2, voidReason: baseInput.reason, kitchenBatchId: 7 } });
        const consume = useTx(tx);

        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        expect(result).toEqual(expect.objectContaining({ replayed: true, voidItemId: 99, voidedQuantity: 2 }));
        expect(consume).not.toHaveBeenCalled();
        expect(tx.orderItem.update).not.toHaveBeenCalled();
    });

    it('an explicitly selected waste warehouse is honored (no routing) and never locked before consumeForOrder', async () => {
        const tx = voidTx();
        const consume = useTx(tx);

        await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2, wasteWarehouseId: 4 });

        const statements = (tx.$queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>)
            .map(([strings]) => strings.join('?'));
        expect(statements.filter((statement) => /`Warehouse`/.test(statement))).toEqual([]);
        expect(tx.warehouse.findFirst as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 4, companyId: 1, branchId: 3, type: 'BRANCH' }
        }));
        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            warehouseId: 4, route: false, expectedBranchId: 3
        }));
    });

    it('without a selected warehouse the default sale warehouse follows ingredient routing', async () => {
        const tx = voidTx();
        const consume = useTx(tx);

        await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            warehouseId: 4, route: true, expectedBranchId: 3
        }));
    });

    it('refuses a channel (PedidosYa) order: its pricing follows the channel rules', async () => {
        const tx = voidTx({ order: { salesChannel: 'PEDIDOSYA' } });
        const consume = useTx(tx);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, baseInput)).rejects.toThrow(/canales externos/);
        expect(consume).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it.each([
        [{ quantity: 1 }],
        [{ quantity: 2, reason: 'Otro motivo distinto' }]
    ])('the same idempotency key with a different request (%o) is a 409 conflict, not a replay', async (patch) => {
        const replay = { id: 99, orderId: 41, voidedFromItemId: 10, voidedQuantity: 2, voidReason: baseInput.reason, kitchenBatchId: 7 };
        const tx = voidTx({ replay });
        const consume = useTx(tx);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, ...patch }))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/otra cantidad o motivo/) });
        expect(consume).not.toHaveBeenCalled();
    });

    it('voiding every line drops the promotion code so a zero-total completion never claims it', async () => {
        const tx = voidTx({
            item: {
                id: 10, orderId: 41, menuItemId: 3, kitchenBatchId: 7, quantity: 1, price: 20, subtotal: 20,
                notes: null, status: 'PENDING', sentAt: new Date(), startedAt: null, finishedAt: null,
                originOrderId: null, originTableId: null, voidedAt: null, modifiers: [],
                menuItem: { id: 3, recipes: [] }
            },
            remainingSubtotals: [0],
            order: { discountCode: 'PROMO10', discount: 2 },
            promotion: {
                active: true, validFrom: new Date('2026-01-01'), validTo: null, usageLimit: null, usageCount: 0,
                minOrderAmount: null, type: 'PERCENTAGE', value: 10, maxDiscount: null
            }
        });
        useTx(tx);

        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, baseInput);

        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 0, discount: 0, discountCode: null, tax: 0, tipAmount: 0 }
        });
        expect(result.promotionRemoved).toEqual({ code: 'PROMO10', reason: expect.stringMatching(/anuladas/) });
    });

    it('re-caps a MESERO manual discount to maxManualDiscountPercent of the new subtotal', async () => {
        // 10.00 fixed on 57.50 (17 %) would become 31 % of 32.50; cap 20 % -> 6.50.
        const tx = voidTx({ order: { discount: 10 }, discountAuthorRole: 'MESERO', maxManualDiscountPercent: '20' });
        useTx(tx);

        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        // net 26.00, tax 3.90, tip min(5.75, 10 % x 26 = 2.60), total 32.50.
        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 32.5, discount: 6.5, discountCode: null, tax: 3.9, tipAmount: 2.6 }
        });
        expect(result.manualDiscountClamped).toEqual({ previousDiscount: 10, discount: 6.5, maxPercent: 20, authorUserId: 6 });
        expect(tx.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KITCHEN_LINE_VOID',
                details: expect.objectContaining({ manualDiscountClamped: expect.objectContaining({ discount: 6.5 }) })
            })
        });
    });

    it('keeps a manual discount set by an uncapped role', async () => {
        const tx = voidTx({ order: { discount: 10 }, discountAuthorRole: 'ADMIN', maxManualDiscountPercent: '20' });
        useTx(tx);
        const result = await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });
        expect(result.manualDiscountClamped).toBeNull();
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 10 })
        }));
    });

    it('the first statements in the transaction are the Table -> Order locking reads (no snapshot before them)', async () => {
        const tx = voidTx();
        useTx(tx);
        jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(12);
        const statements: string[] = [];
        (tx.$queryRaw as unknown as jest.Mock).mockImplementation((async (strings: TemplateStringsArray) => {
            const sql = strings.join('?');
            statements.push(sql);
            return /FROM `Order`/.test(sql) ? [{ id: 41, tableId: 12 }] : [];
        }) as never);

        await OrderService.voidKitchenItem(41, 10, 1, 8, { ...baseInput, quantity: 2 });

        expect(statements[0]).toMatch(/FROM `Table`.*FOR UPDATE/);
        expect(statements[1]).toMatch(/FROM `Order`.*FOR UPDATE/);
        // Every plain read (replay lookup, order, item) comes after both locks.
        const orderLockAt = (tx.$queryRaw as unknown as jest.Mock).mock.invocationCallOrder[1];
        const firstPlainRead = Math.min(
            ...tx.orderItem.findFirst.mock.invocationCallOrder,
            ...tx.order.findFirst.mock.invocationCallOrder
        );
        expect(firstPlainRead).toBeGreaterThan(orderLockAt);
    });

    it('raises a retryable P2034 when the order moved table between the preflight and the Order lock', async () => {
        const tx = voidTx();
        jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(12);
        (tx.$queryRaw as unknown as jest.Mock).mockImplementation((async (strings: TemplateStringsArray) => (
            /FROM `Order`/.test(strings.join('?')) ? [{ id: 41, tableId: 13 }] : []
        )) as never);
        await expect(OrderService.lockTableThenOrder(tx as never, 1, 41)).rejects.toMatchObject({ code: 'P2034' });
        const sql = (tx.$queryRaw as unknown as jest.Mock).mock.calls.map((call) => (call[0] as TemplateStringsArray).join('?'));
        // Never locks the new table after the Order (no Order -> Table inversion).
        expect(sql.filter((statement) => /FROM `Table`/.test(statement))).toHaveLength(1);
    });

    it('rejects a key already used for another line', async () => {
        const tx = voidTx({ replay: { id: 99, orderId: 41, voidedFromItemId: 12, voidedQuantity: 1, kitchenBatchId: 7 } });
        useTx(tx);
        await expect(OrderService.voidKitchenItem(41, 10, 1, 8, baseInput)).rejects.toThrow(/otra línea/i);
    });

    it('is a supervisor route with an idempotency requirement and ships its migration', () => {
        const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/order.routes.ts'), 'utf8');
        expect(routes).toContain("router.post('/:id/items/:itemId/void', requirePermission('orders.items.void', 'SUPERADMIN', 'ADMIN')");
        const controller = fs.readFileSync(path.resolve(__dirname, '../../controllers/order.controller.ts'), 'utf8');
        expect(controller).toContain("statusCode: 428");
        expect(controller).toContain("'ITEM_VOIDED'");
        const migration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260808_kitchen_line_void/migration.sql'),
            'utf8'
        );
        expect(migration).toContain('`voidedQuantity` INTEGER NOT NULL DEFAULT 0');
        expect(migration).toContain('OrderItem_orderId_voidIdempotencyKey_key');
        expect(migration).toContain("'orders.items.void'");
    });
});
