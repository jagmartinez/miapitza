import { describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { AuditLogService } from '../../services/audit-log.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { CostingService } from '../../services/costing.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

describe('PurchaseOrderService accounting invariants', () => {
    it('defaults an omitted invoice type to a fully settled cash purchase', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.supplier, 'findFirst').mockResolvedValue({ id: 3 } as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{ id: 4 }] as never);

        let createdOrderData: Record<string, unknown> = {};
        let createdItemData: Record<string, unknown> = {};
        const tx = {
            purchaseOrder: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    createdOrderData = args.data;
                    return { id: 10 };
                }),
                findUnique: jest.fn(async () => ({ id: 10 }))
            },
            purchaseOrderItem: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    createdItemData = args.data;
                    return {};
                })
            },
            productUnit: { findFirst: jest.fn(async () => null) },
            product: { findFirst: jest.fn(async () => ({ baseUnit: null, unit: 'kg' })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const conversion = jest.spyOn(UnitConversionService, 'convertWithCost').mockResolvedValue({
            baseQuantity: 2,
            conversionFactor: 1,
            originalQuantity: 2,
            originalUnit: 'kg',
            baseUnit: 'kg',
            baseCost: 10.125,
            originalCost: 10.125
        });

        await PurchaseOrderService.create(1, {
            branchId: 2,
            supplierId: 3,
            items: [{ productId: 4, quantity: 2, cost: 10.125 }]
        });

        expect(createdOrderData.invoiceType).toBe('CASH');
        expect(createdOrderData.total).toBe(20.25);
        expect(createdOrderData.paymentStatus).toBe('PAID');
        expect(createdOrderData.paidAmount).toBe(20.25);
        expect(conversion).toHaveBeenCalledWith(4, 1, 2, 'kg', 10.125, tx as never);
        expect(createdItemData).toEqual(expect.objectContaining({
            purchaseUnit: 'kg', conversionFactor: 1, baseQuantity: 2, baseCost: 10.125
        }));
    });

    it('rejects payments before a credit purchase has been received', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
            id: 10,
            invoiceType: 'CREDIT',
            status: 'ISSUED',
            paidAmount: 0,
            total: 100
        } as never);

        await expect(PurchaseOrderService.addPayment(10, 1, { amount: 10 }))
            .rejects.toThrow(/recibidas/i);
    });

    it('normalizes payments to currency precision before status and persistence', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
            id: 10,
            invoiceType: 'CREDIT',
            status: 'RECEIVED',
            paidAmount: 0,
            total: 10
        } as never);
        let paymentData: Record<string, unknown> = {};
        let updateData: Record<string, unknown> = {};
        const tx = {
            purchaseOrderPayment: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    paymentData = args.data;
                    return { id: 1 };
                })
            },
            purchaseOrder: {
                updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updateData = args.data;
                    return { count: 1 };
                }),
                findUnique: jest.fn(async () => ({ paidAmount: 10 }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PurchaseOrderService.addPayment(10, 1, { amount: 9.999 });
        expect(paymentData.amount).toBe(10);
        expect(updateData.paidAmount).toBe(10);
        expect(updateData.paymentStatus).toBe('PAID');
    });

    it('rechecks the state under lock and rejects a concurrent receipt before editing', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'RECEIVED' })),
                update: jest.fn(async () => ({}))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.update(10, 1, { notes: 'late edit' }))
            .rejects.toThrow(/RECEIVED/);
        expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('keeps issued commercial terms immutable while allowing cancellation', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'ISSUED', invoiceType: 'CREDIT', total: 50 })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.update(10, 1, { notes: 'changed' }))
            .rejects.toThrow(/inmutable/i);
        await expect(PurchaseOrderService.update(10, 1, { status: 'CANCELLED' }))
            .resolves.toEqual({});
        expect(updates).toEqual([{
            status: 'CANCELLED',
            paidAmount: 0,
            paymentStatus: 'PENDING'
        }]);
    });

    it('reverses a payment immutably and recomputes the credit balance from active rows', async () => {
        const paymentUpdates: Array<Record<string, unknown>> = [];
        const orderUpdates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, invoiceType: 'CREDIT', status: 'RECEIVED', total: 100 })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    orderUpdates.push(args.data);
                    return {};
                })
            },
            purchaseOrderPayment: {
                findFirst: jest.fn(async () => ({ id: 5, status: 'ACTIVE', amount: 40 })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    paymentUpdates.push(args.data);
                    return { id: 5, amount: 40 };
                }),
                aggregate: jest.fn(async () => ({ _sum: { amount: 25 } }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        const result = await PurchaseOrderService.reversePayment(10, 5, 1, 9, 'Pago duplicado');

        expect(paymentUpdates[0]).toEqual(expect.objectContaining({
            status: 'REVERSED',
            reversedById: 9,
            reversalReason: 'Pago duplicado'
        }));
        expect(orderUpdates).toEqual([{ paidAmount: 25, paymentStatus: 'PARTIAL' }]);
        expect(result).toEqual(expect.objectContaining({ paidAmount: 25, paymentStatus: 'PARTIAL' }));
    });

    it('reverses an untouched receipt through the original source layers and cost ledger', async () => {
        const orderUpdates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({
                    id: 10,
                    status: 'RECEIVED',
                    items: [{ id: 31 }, { id: 32 }]
                })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    orderUpdates.push(args.data);
                    return { id: 10, ...args.data };
                })
            },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            inventoryBatch: {
                findMany: jest.fn(async () => [
                    { warehouseId: 4, productId: 7, originalQty: 2 },
                    { warehouseId: 4, productId: 7, originalQty: 3 },
                    { warehouseId: 4, productId: 8, originalQty: 1 }
                ])
            },
            product: { findFirst: jest.fn(async ({ where }: { where: { id: number } }) => ({ name: `P${where.id}` })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const movementSpy = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 1, balanceQty: 0, balanceCost: 0, unitCost: 5, totalCost: 5, consumedLayers: []
        });
        const costSpy = jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Recepción duplicada');

        expect(movementSpy).toHaveBeenCalledTimes(2);
        expect(movementSpy).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            type: 'OUT', productId: 7, quantity: 5, warehouseId: 4,
            consumeSourceRef: 'PO-10', valueFromConsumedLayers: true
        }));
        expect(costSpy).toHaveBeenCalledWith(tx as never, [31, 32], 1);
        expect(orderUpdates).toEqual([{ status: 'CANCELLED', paidAmount: 0, paymentStatus: 'PENDING' }]);
    });

    it('blocks receipt reversal until every payment has been reversed', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'RECEIVED', items: [] }))
            },
            purchaseOrderPayment: { count: jest.fn(async () => 1) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.reverseReceipt(10, 1, 9, 'Corrección'))
            .rejects.toThrow(/abonos activos/i);
    });
});
