import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import {
    InventoryConsumptionService,
    ORDER_CONSUMPTION_SNAPSHOT_ACTION
} from '../../services/inventory-consumption.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { CateringFiscalService } from '../../services/catering-fiscal.service';
import { CostingService } from '../../services/costing.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { NEGATIVE_SALE_STOCK_ACTION } from '../../services/stock-alert.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
const fn = <T extends AnyFn = AnyFn>(impl?: T) => jest.fn(impl as any) as unknown as jest.Mock<AnyFn>;

afterEach(() => {
    jest.restoreAllMocks();
});

function settledOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: 9,
        branchId: 2,
        status: 'READY',
        financialStatus: 'PAID',
        orderType: 'DINE_IN',
        salesChannel: 'RESTAURANT',
        items: [{ sentAt: new Date() }],
        kitchenBatches: [{ status: 'RELEASED' }],
        ...overrides
    };
}

describe('1a. automatic delivery of settled, kitchen-released orders', () => {
    function autoTx(
        order: Record<string, unknown>,
        warehouses: Array<{ id: number }>,
        defaultSale: { id: number | null; valid?: boolean } = { id: null }
    ) {
        return {
            order: { findFirst: fn(async () => order) },
            branch: { findFirst: fn(async () => ({ defaultSaleWarehouseId: defaultSale.id })) },
            warehouse: {
                findMany: fn(async () => warehouses),
                findFirst: fn(async () => (defaultSale.id && defaultSale.valid !== false ? { id: defaultSale.id } : null))
            },
            auditLog: { create: fn(async () => ({})) },
            $executeRawUnsafe: fn(async () => 0)
        };
    }

    it('rolls back only the delivery (savepoint) when inventory is not ready, keeping payment/release alive', async () => {
        jest.spyOn(OrderService, 'completeWithTransaction')
            .mockRejectedValue(new Error('PRODUCT_COST_MISSING: el producto 4 no tiene costo'));
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const tx = autoTx(settledOrder(), [{ id: 5 }]);

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result).toEqual({ delivered: false, reason: 'INVENTORY_NOT_READY' });
        const sql = tx.$executeRawUnsafe.mock.calls.map((c) => c[0]);
        expect(sql).toEqual(['SAVEPOINT auto_deliver', 'ROLLBACK TO SAVEPOINT auto_deliver']);
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'AUTO_DELIVER_SKIPPED', details: expect.objectContaining({ reason: 'INVENTORY_NOT_READY' }) })
        }));
    });

    it('propagates deadlocks from auto-delivery so the transaction retry wrapper can rerun it', async () => {
        const deadlock = Object.assign(new Error('deadlock'), { code: 'P2034' });
        jest.spyOn(OrderService, 'completeWithTransaction').mockRejectedValue(deadlock);
        const tx = autoTx(settledOrder(), [{ id: 5 }]);

        await expect(OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7)).rejects.toBe(deadlock);
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('delivers through completeWithTransaction with the single branch warehouse', async () => {
        const complete = jest.spyOn(OrderService, 'completeWithTransaction')
            .mockResolvedValue({ id: 9, status: 'DELIVERED' } as never);
        const tx = autoTx(settledOrder(), [{ id: 5 }]);

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result.delivered).toBe(true);
        expect(complete).toHaveBeenCalledWith(tx as never, 9, 1, 5, 7, { automatic: true });
        expect(tx.warehouse.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 1, branchId: 2, type: 'BRANCH' }
        }));
    });

    it.each([
        ['unpaid', { financialStatus: 'PARTIAL' }, 'NOT_READY_OR_UNPAID'],
        ['still in kitchen', { status: 'IN_PREPARATION' }, 'NOT_READY_OR_UNPAID'],
        ['batch ready but not released', { kitchenBatches: [{ status: 'READY' }] }, 'KITCHEN_NOT_RELEASED'],
        ['unsent lines', { items: [{ sentAt: null }] }, 'UNSENT_ITEMS'],
        ['PedidosYa channel', { salesChannel: 'PEDIDOSYA' }, 'CHANNEL_DELIVERY'],
        ['delivery order', { orderType: 'DELIVERY' }, 'CHANNEL_DELIVERY'],
    ])('does not deliver when %s', async (_label, overrides, reason) => {
        const complete = jest.spyOn(OrderService, 'completeWithTransaction');
        const tx = autoTx(settledOrder(overrides), [{ id: 5 }]);

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result).toEqual({ delivered: false, reason });
        expect(complete).not.toHaveBeenCalled();
    });

    it('keeps the explicit warehouse choice when the branch has several sale warehouses', async () => {
        const complete = jest.spyOn(OrderService, 'completeWithTransaction');
        const tx = autoTx(settledOrder(), [{ id: 5 }, { id: 6 }]);

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result).toEqual({ delivered: false, reason: 'AMBIGUOUS_BRANCH_WAREHOUSE' });
        expect(complete).not.toHaveBeenCalled();
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'AUTO_DELIVER_SKIPPED' })
        }));
    });

    it('uses the branch default sale warehouse even when the branch has several sale warehouses', async () => {
        const complete = jest.spyOn(OrderService, 'completeWithTransaction')
            .mockResolvedValue({ id: 9, status: 'DELIVERED' } as never);
        const tx = autoTx(settledOrder(), [{ id: 5 }, { id: 6 }], { id: 6 });

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result.delivered).toBe(true);
        expect(complete).toHaveBeenCalledWith(tx as never, 9, 1, 6, 7, { automatic: true });
        expect(tx.warehouse.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 6, companyId: 1, branchId: 2, type: 'BRANCH' }
        }));
        expect(tx.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('ignores a stale default sale warehouse and falls back to the single-warehouse rule', async () => {
        const complete = jest.spyOn(OrderService, 'completeWithTransaction')
            .mockResolvedValue({ id: 9, status: 'DELIVERED' } as never);
        const tx = autoTx(settledOrder(), [{ id: 5 }], { id: 99, valid: false });

        const result = await OrderService.autoDeliverIfSettledWithTransaction(tx as never, 9, 1, 7);

        expect(result.delivered).toBe(true);
        expect(complete).toHaveBeenCalledWith(tx as never, 9, 1, 5, 7, { automatic: true });
    });

    function paymentTx(status: string) {
        return {
            $queryRaw: fn(async () => []),
            order: {
                findFirst: fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: null, total: 100, status,
                    financialStatus: 'PARTIAL', cashRegisterId: null, discountCode: null,
                    preInvoicedAt: new Date(), invoiceNumber: null, invoiceFiscalStatus: 'NOT_ISSUED',
                    payments: [{ amount: 40 }]
                })),
                update: fn(async () => ({}))
            },
            user: { findFirst: fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: fn(async () => ({ id: 2, type: 'CARD' })) },
            payment: { create: fn(async () => ({ id: 44, amount: 60 })) },
            promotionReservation: { findFirst: fn(async () => null) }
        };
    }

    it('auto-delivers inside the payment transaction when the final payment settles a READY order', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ tableId: null } as never);
        const tx = paymentTx('READY');
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: unknown) => unknown) => cb(tx)) as never);
        const auto = jest.spyOn(OrderService, 'autoDeliverIfSettledWithTransaction')
            .mockResolvedValue({ delivered: true } as never);

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 2, amount: 60 }, 7);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ financialStatus: 'PAID' })
        }));
        expect(auto).toHaveBeenCalledWith(tx as never, 9, 1, 7);
    });

    it('leaves an in-kitchen paid order for the kitchen release to deliver', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ tableId: null } as never);
        const tx = paymentTx('IN_PREPARATION');
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: unknown) => unknown) => cb(tx)) as never);
        const auto = jest.spyOn(OrderService, 'autoDeliverIfSettledWithTransaction');

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 2, amount: 60 }, 7);

        expect(auto).not.toHaveBeenCalled();
    });

    it('auto-delivers when the kitchen releases the last batch of an already-paid order', async () => {
        const tx = {
            $queryRaw: fn(async () => []),
            order: {
                findFirst: fn(async () => ({ id: 9, branchId: 2, status: 'READY' })),
                findUnique: fn(async () => ({
                    id: 9, status: 'READY', kitchenReleasedAt: null, items: [],
                    kitchenBatches: [{ status: 'RELEASED', startedAt: null, startedById: null, releasedAt: new Date(), releasedById: 7 }]
                })),
                update: fn(async () => ({}))
            },
            kitchenBatch: {
                findFirst: fn(async () => ({ id: 3, status: 'READY', sequence: 1 })),
                update: fn(async () => ({})),
                findUnique: fn(async () => ({ id: 3, status: 'RELEASED', sequence: 1, order: { id: 9 }, items: [] }))
            },
            auditLog: { create: fn(async () => ({})) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: unknown) => unknown) => cb(tx)) as never);
        const auto = jest.spyOn(OrderService, 'autoDeliverIfSettledWithTransaction')
            .mockResolvedValue({ delivered: true } as never);

        const result = await OrderService.releaseFromKitchen(9, 1, 7, 3);

        expect(auto).toHaveBeenCalledWith(tx as never, 9, 1, 7);
        expect(result).toEqual(expect.objectContaining({ changed: true, autoDelivered: true }));
    });
});

describe('1b. sale consumption may go negative and raises a stock alert', () => {
    it('passes allowNegative to the engine, records the per-line snapshot and a negative-stock alert', async () => {
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 0.2, originalQuantity: 200, originalUnit: 'g', conversionFactor: 0.001
        } as never);
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 1, unitCost: 1, totalCost: 1, balanceQty: -0.4, balanceCost: -0.4 });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const tx = {
            inventoryMovement: { findMany: fn(async () => []) },
            orderItemModifier: { findMany: fn(async () => []) },
            auditLog: { create: fn(async () => ({})) }
        };

        const result = await InventoryConsumptionService.consumeForOrder(tx as never, {
            order: {
                id: 9, userId: 7,
                items: [{
                    id: 31, quantity: 3,
                    menuItem: { recipes: [{ productId: 4, quantity: 200, unit: 'g', product: { name: 'Carne', unit: 'kg' } }] }
                }]
            },
            warehouseId: 5, userId: 7, companyId: 1, allowNegative: true
        });

        expect(apply).toHaveBeenCalledWith(tx as never, expect.objectContaining({ allowNegative: true, reference: 'ORD-9' }));
        expect(result.negativeProductIds).toEqual([4]);
        const actions = tx.auditLog.create.mock.calls.map((call) => (call[0] as { data: { action: string } }).data.action);
        expect(actions).toEqual([ORDER_CONSUMPTION_SNAPSHOT_ACTION, NEGATIVE_SALE_STOCK_ACTION]);
        const snapshot = (tx.auditLog.create.mock.calls[0][0] as { data: { details: any } }).data.details;
        expect(snapshot.items).toEqual([{ orderItemId: 31, itemQuantity: 3, products: [{ productId: 4, quantity: expect.closeTo(0.6, 9), warehouseId: 5 }] }]);
        expect(warn).toHaveBeenCalled();
    });

    it('keeps the strict guard for non-sale consumption', async () => {
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 1, originalQuantity: 1, originalUnit: 'u', conversionFactor: 1
        } as never);
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 1, unitCost: 1, totalCost: 1, balanceQty: 0, balanceCost: 0 });
        const tx = {
            inventoryMovement: { findMany: fn(async () => []) },
            orderItemModifier: { findMany: fn(async () => []) },
            auditLog: { create: fn(async () => ({})) }
        };
        await InventoryConsumptionService.consumeForOrder(tx as never, {
            order: { id: 9, userId: 7, items: [{ id: 31, quantity: 1, menuItem: { recipes: [{ productId: 4, quantity: 1, product: { name: 'X', unit: 'u' } }] } }] },
            warehouseId: 5, userId: 7, companyId: 1, reference: 'WASTE-ORD-9'
        });
        expect(apply.mock.calls[0][1]).not.toHaveProperty('allowNegative');
        // Waste never writes a sale consumption snapshot.
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
});

describe('1b. engine negative-balance bookkeeping', () => {
    function engineTx(opts: { costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE'; stock: number; batches: Array<{ id: number; unitCost: number; remainingQty: number }>; avgCost?: number }) {
        const batchCreates: Array<Record<string, unknown>> = [];
        const live = opts.batches.map((batch) => ({ ...batch, sourceRef: null, sourceType: 'PURCHASE', sourceMovementId: null, createdAt: new Date(0) }));
        const tx = {
            warehouse: { findFirst: fn(async () => ({ id: 1 })) },
            stock: {
                findUnique: fn(async () => ({ id: 1, quantity: opts.stock })),
                create: fn(),
                update: fn(async () => ({}))
            },
            product: {
                findFirst: fn(async () => ({ currentAverageCost: opts.avgCost ?? 2, averageCostKnown: true, cost: null, referenceCostKnown: false })),
                update: fn(async () => ({}))
            },
            company: { findUnique: fn(async () => ({ costingMethod: opts.costingMethod })) },
            inventoryBatch: {
                findMany: fn(async () => live.filter((batch) => batch.remainingQty > 0)),
                create: fn(async (args: { data: Record<string, unknown> }) => { batchCreates.push(args.data); return { id: 99 }; }),
                update: fn(async (args: { where: { id: number }; data: { remainingQty: number } }) => {
                    const row = live.find((batch) => batch.id === args.where.id);
                    if (row) row.remainingQty = args.data.remainingQty;
                    return {};
                }),
                updateMany: fn(async () => ({ count: 1 }))
            },
            inventoryMovement: { create: fn(async () => ({ id: 1 })) },
            $queryRaw: fn(async () => [])
        };
        jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(0);
        jest.spyOn(CostingService, 'getOutflowUnitCost').mockResolvedValue(opts.avgCost ?? 2);
        return { tx, batchCreates };
    }

    it('FIFO: an authorized sale beyond the layers goes negative instead of failing', async () => {
        const { tx } = engineTx({ costingMethod: 'FIFO', stock: 1, batches: [{ id: 1, unitCost: 3, remainingQty: 1 }], avgCost: 3 });
        const result = await InventoryEngineService.applyMovement(tx as never, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 4, userId: 7, quantity: 3, allowNegative: true
        });
        expect(result.balanceQty).toBe(-2);
        expect(result.totalCost).toBeCloseTo(9, 9);
    });

    it('FIFO: still fails closed without allowNegative', async () => {
        const { tx } = engineTx({ costingMethod: 'FIFO', stock: 1, batches: [{ id: 1, unitCost: 3, remainingQty: 1 }] });
        await expect(InventoryEngineService.applyMovement(tx as never, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 4, userId: 7, quantity: 3
        })).rejects.toThrow(/Stock insuficiente/);
    });

    it('an inbound first covers the negative balance; only the remainder opens a layer', async () => {
        const { tx, batchCreates } = engineTx({ costingMethod: 'FIFO', stock: -2, batches: [] });
        const result = await InventoryEngineService.applyMovement(tx as never, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 4, userId: 7, quantity: 10, unitCost: 5
        });
        expect(result.balanceQty).toBe(8);
        expect(batchCreates).toHaveLength(1);
        expect(batchCreates[0]).toEqual(expect.objectContaining({ originalQty: 8, remainingQty: 8 }));
        expect(result.balanceCost).toBeCloseTo(40, 9);
    });

    it('reads the costing method without locking Company (no Company/Warehouse lock inversion)', async () => {
        const tx = {
            $queryRaw: fn(async () => []),
            company: { findUnique: fn(async () => ({ costingMethod: 'FIFO' })) }
        };
        await expect(InventoryEngineService.readCostingMethod(tx as never, 1)).resolves.toBe('FIFO');
        expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
});

describe('2. catering credit note under weighted average', () => {
    it('reconciles quantities only and restores the movement value, not the FIFO layer value', async () => {
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 2, unitCost: 4, totalCost: 8, balanceQty: 2, balanceCost: 8 });
        const fold = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
        const tx = {
            $queryRaw: fn(async () => [{ costingMethod: 'WEIGHTED_AVERAGE' }]),
            company: { findUnique: fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            inventoryMovement: {
                findMany: fn(async () => [{
                    id: 70, warehouseId: 5, productId: 4, quantity: 2, totalCost: 8,
                    consumedLayers: [{ quantity: 2, unitCost: 3, sourceRef: 'PO-1', sourceType: 'PURCHASE' }]
                }]),
                findFirst: fn(async () => null)
            },
            stock: { aggregate: fn(async () => ({ _sum: { quantity: 0 } })) },
            product: {
                findFirst: fn(async () => ({ currentAverageCost: 4, averageCostKnown: true })),
                update: fn(async () => ({}))
            }
        };

        await (CateringFiscalService as any).reverseFinishedInventory(tx, {
            eventId: 1, companyId: 1, userId: 7, creditNoteNumber: 'NC-1'
        });

        expect(apply).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            quantity: 2,
            unitCost: 4,
            inboundLayers: [expect.objectContaining({ quantity: 2, unitCost: 3 })]
        }));
        // D8: the WA fold writes ProductCostHistory linked to the return movement.
        expect(fold).toHaveBeenCalledWith(tx as never, 4, 1, 2, 4, 0, undefined, 2);
    });

    it('folds a return with positive prior stock through the history-writing helper', async () => {
        jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 3, unitCost: 4, totalCost: 8, balanceQty: 7, balanceCost: 28 });
        const fold = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
        const tx = {
            company: { findUnique: fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            $queryRaw: fn(async () => []),
            inventoryMovement: {
                findMany: fn(async () => [{
                    id: 71, warehouseId: 5, productId: 4, quantity: 2, totalCost: 8,
                    consumedLayers: [{ quantity: 2, unitCost: 3 }]
                }]),
                findFirst: fn(async () => null)
            },
            stock: { aggregate: fn(async () => ({ _sum: { quantity: 5 } })) },
            product: {
                findFirst: fn(async () => ({ currentAverageCost: 6, averageCostKnown: true })),
                update: fn(async () => ({}))
            }
        };
        await (CateringFiscalService as any).reverseFinishedInventory(tx, {
            eventId: 1, companyId: 1, userId: 7, creditNoteNumber: 'NC-2'
        });
        expect(fold).toHaveBeenCalledWith(tx as never, 4, 1, 2, 4, 5, undefined, 3);
        expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('still rejects a FIFO movement whose layers do not reconcile with its value', async () => {
        const tx = {
            $queryRaw: fn(async () => [{ costingMethod: 'FIFO' }]),
            company: { findUnique: fn(async () => ({ costingMethod: 'FIFO' })) },
            inventoryMovement: {
                findMany: fn(async () => [{
                    id: 70, warehouseId: 5, productId: 4, quantity: 2, totalCost: 8,
                    consumedLayers: [{ quantity: 2, unitCost: 3 }]
                }]),
                findFirst: fn(async () => null)
            }
        };
        await expect((CateringFiscalService as any).reverseFinishedInventory(tx, {
            eventId: 1, companyId: 1, userId: 7, creditNoteNumber: 'NC-1'
        })).rejects.toThrow(/no concilia/);
    });
});

describe('3. partial credit notes reverse the frozen consumption snapshot', () => {
    const item = (id: number, recipeQuantity: number) => ({
        id, orderId: 9, quantity: 4,
        menuItem: { recipes: [{ productId: 4, quantity: recipeQuantity, unit: 'kg', product: { name: 'Carne', unit: 'kg', baseUnit: null }, unitOfMeasure: null }] },
        modifiers: []
    });

    it('uses the snapshot proportionally even when the recipe changed', async () => {
        const convert = jest.spyOn(UnitConversionService, 'convert');
        const tx = {
            auditLog: {
                findFirst: fn(async () => ({
                    details: { reference: 'ORD-9', warehouseId: 5, items: [{ orderItemId: 31, itemQuantity: 4, products: [{ productId: 4, quantity: 0.8 }] }] }
                }))
            }
        };
        const quantities = await (CreditNoteService as any).returnedInventoryQuantities(
            tx, 1, [{ orderItemId: 31, quantity: 1 }], [item(31, 999)]
        );
        expect(quantities).toEqual([{ productId: 4, quantity: expect.closeTo(0.2, 9) }]);
        expect(convert).not.toHaveBeenCalled();
    });

    it('falls back to the current recipe for legacy orders without a snapshot', async () => {
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({ baseQuantity: 0.3 } as never);
        const tx = { auditLog: { findFirst: fn(async () => null) } };
        const quantities = await (CreditNoteService as any).returnedInventoryQuantities(
            tx, 1, [{ orderItemId: 31, quantity: 2 }], [item(31, 0.3)]
        );
        expect(quantities).toEqual([{ productId: 4, quantity: expect.closeTo(0.6, 9) }]);
    });
});

describe('4. Table -> Order lock order', () => {
    it('reads the candidate table outside the tx, locks Table then Order, and retries (P2034) if the order moved', async () => {
        const calls: string[] = [];
        const tx = {
            $queryRaw: fn(async (strings: TemplateStringsArray) => {
                const sql = strings.join('?');
                calls.push(sql);
                if (/SELECT id, tableId FROM `Order`/.test(sql)) return [{ id: 9, tableId: 4 }];
                return [];
            })
        };
        jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(3);
        await expect(OrderService.lockTableThenOrder(tx as never, 1, 9)).rejects.toMatchObject({ code: 'P2034' });
        // No plain read through tx: the first statement is already a lock.
        expect(calls.map((sql) => sql.match(/FROM `(\w+)`/)?.[1])).toEqual(['Table', 'Order']);
        expect(calls.every((sql) => /FOR UPDATE/.test(sql))).toBe(true);

        calls.length = 0;
        jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(4);
        await OrderService.lockTableThenOrder(tx as never, 1, 9);
        expect(calls.map((sql) => sql.match(/FROM `(\w+)`/)?.[1])).toEqual(['Table', 'Order']);
    });
});

describe('5. orders list text search', () => {
    it('matches order number, invoice, customer, table and waiter', () => {
        expect(OrderService.buildOrderSearchWhere('#42')).toEqual({
            OR: [
                { customerName: { contains: '#42' } },
                { invoiceNumber: { contains: '#42' } },
                { table: { is: { number: { contains: '#42' } } } },
                { user: { is: { name: { contains: '#42' } } } },
                { id: 42 }
            ]
        });
        expect(OrderService.buildOrderSearchWhere('  ana ')).toEqual({
            OR: [
                { customerName: { contains: 'ana' } },
                { invoiceNumber: { contains: 'ana' } },
                { table: { is: { number: { contains: 'ana' } } } },
                { user: { is: { name: { contains: 'ana' } } } }
            ]
        });
        expect(OrderService.buildOrderSearchWhere('   ')).toBeNull();
    });

    it('keeps tenant/branch scoping and the pagination shape', async () => {
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.order, 'count').mockResolvedValue(0 as never);
        const result = await OrderService.getAll(1, { branchId: 2, search: 'ana', page: 1, limit: 10 });
        const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toEqual(expect.objectContaining({ companyId: 1, branchId: 2, AND: [expect.objectContaining({ OR: expect.any(Array) })] }));
        expect(result).toHaveProperty('pagination');
    });
});
