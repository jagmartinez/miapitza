import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import { InvoiceService } from '../../services/invoice.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';
import { ProductionOrderService } from '../../services/production-order.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { runDemoCleanup } from '../../scripts/cleanup-demo-data';

/**
 * These tests are executed only by the integration Jest configuration, whose
 * global setup refuses any DATABASE_URL that does not contain `_test`.
 * They never connect to or mutate production.
 */
describe('Recipe inventory flows (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;

    let companyId: number;
    let branchId: number;
    let roleId: number;
    let userId: number;
    let categoryId: number;
    let warehouseId: number;
    let gramUnitId: number;
    let unitUnitId: number;
    let saleIngredientId: number;
    let productionIngredientId: number;
    let outputProductId: number;
    let menuItemId: number;
    let paymentMethodId: number;
    let orderId: number;
    let productionRecipeId: number;
    let productionOrderId: number;

    const quantity = async (productId: number) => {
        const stock = await prisma.stock.findUnique({
            where: { warehouseId_productId: { warehouseId, productId } }
        });
        return Number(stock?.quantity || 0);
    };

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: `Recipe E2E ${suffix}`, costingMethod: 'WEIGHTED_AVERAGE' }
        });
        companyId = company.id;

        const branch = await prisma.branch.create({
            data: { companyId, name: `Branch ${suffix}`, code: `RE2E-${suffix}` }
        });
        branchId = branch.id;

        const role = await prisma.role.create({
            data: { companyId, name: `ADMIN_RECIPE_E2E_${suffix}` }
        });
        roleId = role.id;

        const user = await prisma.user.create({
            data: {
                companyId,
                branchId,
                roleId,
                name: 'Recipe E2E User',
                email: `recipe-e2e-${suffix}@example.test`,
                username: `recipe_e2e_${suffix}`,
                password: 'integration-only',
                mustChangePassword: false,
                status: 'ACTIVE'
            }
        });
        userId = user.id;

        const category = await prisma.category.create({
            data: {
                companyId,
                name: `Recipe E2E Category ${suffix}`,
                codePrefix: `E${String(companyId).slice(-5)}`,
                showInMenu: true,
                showInInventory: true
            }
        });
        categoryId = category.id;

        const warehouse = await prisma.warehouse.create({
            data: {
                companyId,
                branchId,
                name: `Recipe E2E Warehouse ${suffix}`,
                code: `RE2E-WH-${suffix}`
            }
        });
        warehouseId = warehouse.id;

        const gram = await prisma.unitOfMeasure.create({
            data: {
                companyId,
                name: 'Gramo',
                abbreviation: 'g',
                measurementType: 'MASS',
                systemFactor: 1
            }
        });
        gramUnitId = gram.id;
        const unit = await prisma.unitOfMeasure.create({
            data: {
                companyId,
                name: 'Unidad',
                abbreviation: 'unidad',
                measurementType: 'UNIT',
                systemFactor: 1
            }
        });
        unitUnitId = unit.id;

        const [saleIngredient, productionIngredient, output] = await Promise.all([
            prisma.product.create({
                data: {
                    companyId,
                    categoryId,
                    name: `Sale ingredient ${suffix}`,
                    sku: `RE2E-SALE-${suffix}`,
                    unit: 'g',
                    baseUnitId: gramUnitId,
                    type: 'INGREDIENT',
                    cost: 2,
                    currentAverageCost: 2
                }
            }),
            prisma.product.create({
                data: {
                    companyId,
                    categoryId,
                    name: `Production ingredient ${suffix}`,
                    sku: `RE2E-PROD-IN-${suffix}`,
                    unit: 'g',
                    baseUnitId: gramUnitId,
                    type: 'INGREDIENT',
                    cost: 2,
                    currentAverageCost: 2
                }
            }),
            prisma.product.create({
                data: {
                    companyId,
                    categoryId,
                    name: `Production output ${suffix}`,
                    sku: `RE2E-PROD-OUT-${suffix}`,
                    unit: 'unidad',
                    baseUnitId: unitUnitId,
                    type: 'INTERMEDIATE'
                }
            })
        ]);
        saleIngredientId = saleIngredient.id;
        productionIngredientId = productionIngredient.id;
        outputProductId = output.id;

        await prisma.stock.createMany({
            data: [
                { companyId, warehouseId, productId: saleIngredientId, quantity: 100 },
                { companyId, warehouseId, productId: productionIngredientId, quantity: 100 },
                { companyId, warehouseId, productId: outputProductId, quantity: 0 }
            ]
        });

        const menuItem = await prisma.menuItem.create({
            data: {
                companyId,
                branchId,
                categoryId,
                name: `Recipe E2E Menu ${suffix}`,
                price: 10,
                type: 'PREPARED',
                recipes: {
                    create: {
                        productId: saleIngredientId,
                        quantity: 2,
                        unit: 'g',
                        unitId: gramUnitId
                    }
                }
            }
        });
        menuItemId = menuItem.id;

        const method = await prisma.paymentMethod.create({
            data: { companyId, name: `CARD_RECIPE_E2E_${suffix}`, active: true }
        });
        paymentMethodId = method.id;

        const productionRecipe = await ProductionRecipeService.create(
            companyId,
            {
                productId: outputProductId,
                name: `Recipe E2E Production ${suffix}`,
                yieldQuantity: 2,
                yieldUnitId: unitUnitId,
                activate: true,
                components: [
                    {
                        componentProductId: productionIngredientId,
                        quantity: 10,
                        unitId: gramUnitId,
                        unit: 'g'
                    }
                ]
            },
            userId
        );
        productionRecipeId = productionRecipe.id;
    });

    afterAll(async () => {
        // If the shared integration setup failed before this fixture was created,
        // never let undefined Prisma filters broaden cleanup to unrelated test data.
        if (!companyId) return;
        // AuditLog has a user FK and service logging is fire-and-forget. Give the
        // queued writes a turn, then remove all fixture data in FK-safe order.
        await new Promise((resolve) => setTimeout(resolve, 25));
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.productCostHistory.deleteMany({ where: { companyId } });
        await prisma.kitchenNotification.deleteMany({ where: { companyId } });
        await prisma.payment.deleteMany({ where: { order: { companyId } } });
        await prisma.orderItemModifier.deleteMany({ where: { orderItem: { order: { companyId } } } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.productionOrderItem.deleteMany({ where: { productionOrder: { companyId } } });
        await prisma.productionOrder.deleteMany({ where: { companyId } });
        await prisma.productionRecipeComponent.deleteMany({ where: { recipe: { companyId } } });
        await prisma.productionRecipe.deleteMany({ where: { companyId } });
        await prisma.recipe.deleteMany({ where: { menuItem: { companyId } } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.productUnit.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.paymentMethod.deleteMany({ where: { companyId } });
        await prisma.promotion.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.unitOfMeasure.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.invoiceSequence.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { id: roleId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it('separates financial payment/reversal from the single operational recipe consumption', async () => {
        const order = await OrderService.create(companyId, {
            branchId,
            userId,
            customerName: `Recipe E2E ${suffix}`,
            items: [{ menuItemId, quantity: 2, price: 10 }]
        });
        if (!order) throw new Error('OrderService.create returned null in recipe E2E fixture.');
        orderId = order.id;
        await InvoiceService.generateInvoice(orderId, companyId);

        const firstPayment = await PaymentService.create(
            companyId,
            { orderId, paymentMethodId, amount: Number(order.total) },
            userId
        );

        expect(await quantity(saleIngredientId)).toBeCloseTo(100, 6);
        expect(await prisma.inventoryMovement.count({
            where: { companyId, reference: `ORD-${orderId}`, type: 'OUT' }
        })).toBe(0);

        await PaymentService.delete(firstPayment.id, companyId, userId, 'Integration refund');
        expect(await quantity(saleIngredientId)).toBeCloseTo(100, 6);

        const reversedMovements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `ORD-${orderId}` },
            select: { type: true, quantity: true }
        });
        const net = reversedMovements.reduce(
            (sum, movement) => sum + (movement.type === 'OUT' ? Number(movement.quantity) : -Number(movement.quantity)),
            0
        );
        expect(net).toBeCloseTo(0, 6);

        const secondPayment = await PaymentService.create(
            companyId,
            { orderId, paymentMethodId, amount: Number(order.total) },
            userId
        );
        expect(await quantity(saleIngredientId)).toBeCloseTo(100, 6);

        await OrderService.sendToKitchen(orderId, companyId);
        const kitchenItems = await prisma.orderItem.findMany({ where: { orderId }, select: { id: true } });
        for (const item of kitchenItems) {
            await OrderService.startItem(orderId, item.id, companyId);
            await OrderService.finishItem(orderId, item.id, companyId);
        }
        expect((await prisma.order.findUnique({ where: { id: orderId } }))?.status).toBe('READY');

        // complete() owns the physical event and consumes the recipe exactly once.
        await OrderService.complete(orderId, companyId, warehouseId, userId);
        expect(await quantity(saleIngredientId)).toBeCloseTo(96, 6);
        const allMovements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `ORD-${orderId}` },
            select: { type: true, quantity: true }
        });
        const outstanding = allMovements.reduce(
            (sum, movement) => sum + (movement.type === 'OUT' ? Number(movement.quantity) : -Number(movement.quantity)),
            0
        );
        expect(outstanding).toBeCloseTo(4, 6);

        // DELIVERED is an operational fact. Reversing finance must preserve both
        // the delivery and its physical inventory consumption.
        await PaymentService.delete(secondPayment.id, companyId, userId, 'Second integration refund');
        expect(await quantity(saleIngredientId)).toBeCloseTo(96, 6);
        const reopened = await prisma.order.findUnique({ where: { id: orderId } });
        expect(reopened?.status).toBe('DELIVERED');
        expect(reopened?.financialStatus).toBe('UNPAID');
        expect(reopened?.closedAt).toBeNull();
    });

    it('preserves invoice, payment and promotion when a paid channel cancellation lacks a credit note', async () => {
        const initialIngredientQuantity = await quantity(saleIngredientId);
        const promotion = await prisma.promotion.create({
            data: {
                companyId,
                code: `RE2E-${suffix}`.toUpperCase(),
                name: `Recipe E2E Promotion ${suffix}`,
                type: 'FIXED_AMOUNT',
                value: 1,
                validFrom: new Date(Date.now() - 60_000),
                usageCount: 0,
                active: true
            }
        });
        const order = await OrderService.create(companyId, {
            branchId,
            userId,
            customerName: `Recipe E2E Channel ${suffix}`,
            items: [{ menuItemId, quantity: 2, price: 10 }]
        });
        if (!order) throw new Error('OrderService.create returned null in channel fixture.');
        await prisma.order.update({
            where: { id: order.id },
            data: { discountCode: promotion.code }
        });
        await InvoiceService.generateInvoice(order.id, companyId);

        await PaymentService.create(
            companyId,
            { orderId: order.id, paymentMethodId, amount: Number(order.total) },
            userId
        );
        expect(await quantity(saleIngredientId)).toBeCloseTo(initialIngredientQuantity, 6);
        expect((await prisma.promotion.findUnique({ where: { id: promotion.id } }))?.usageCount).toBe(1);

        await expect(OrderService.cancel(
            order.id,
            companyId,
            userId,
            'External channel cancellation',
            { allowPaidReversal: true }
        )).rejects.toThrow('nota de cr');
        expect(await quantity(saleIngredientId)).toBeCloseTo(initialIngredientQuantity, 6);
        expect(await prisma.payment.count({ where: { orderId: order.id, status: 'ACTIVE' } })).toBe(1);
        expect(await prisma.payment.count({ where: { orderId: order.id, status: 'REVERSED' } })).toBe(0);
        expect((await prisma.promotion.findUnique({ where: { id: promotion.id } }))?.usageCount).toBe(1);

        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `ORD-${order.id}` },
            select: { type: true, quantity: true }
        });
        const net = movements.reduce(
            (sum, movement) => sum + (movement.type === 'OUT' ? Number(movement.quantity) : -Number(movement.quantity)),
            0
        );
        expect(net).toBeCloseTo(0, 6);
    });

    it('finishes production with matching cost/stock and fully reverses it on cancellation', async () => {
        const openingSourceRef = `OPENING-RECIPE-E2E-${suffix}`;
        await prisma.stock.update({
            where: { warehouseId_productId: { warehouseId, productId: outputProductId } },
            data: { quantity: 3 }
        });
        await prisma.product.update({
            where: { id: outputProductId },
            data: { currentAverageCost: 7, cost: 7 }
        });
        await prisma.inventoryBatch.create({
            data: {
                companyId,
                warehouseId,
                productId: outputProductId,
                unitCost: 7,
                originalQty: 3,
                remainingQty: 3,
                sourceType: 'OPENING',
                sourceRef: openingSourceRef
            }
        });

        const order = await ProductionOrderService.create(
            companyId,
            {
                productId: outputProductId,
                recipeId: productionRecipeId,
                plannedQuantity: 4,
                warehouseId,
                branchId,
                status: 'PENDING'
            },
            userId
        );
        productionOrderId = order.id;
        await ProductionOrderService.setStatus(productionOrderId, companyId, 'IN_PROGRESS', userId);

        const finished = await ProductionOrderService.finish(
            productionOrderId,
            companyId,
            userId,
            { producedQuantity: 4 }
        );

        expect(finished.status).toBe('FINISHED');
        expect(await quantity(productionIngredientId)).toBeCloseTo(80, 6);
        expect(await quantity(outputProductId)).toBeCloseTo(7, 6);
        expect(Number(finished.realCost)).toBeCloseTo(40, 6);
        expect(Number(finished.realUnitCost)).toBeCloseTo(10, 6);
        expect(await prisma.productCostHistory.count({
            where: { companyId, productionOrderId }
        })).toBe(1);

        const cancelled = await ProductionOrderService.cancel(
            productionOrderId,
            companyId,
            userId,
            'Recipe E2E rollback'
        );
        expect(cancelled.status).toBe('CANCELLED');
        expect(await quantity(productionIngredientId)).toBeCloseTo(100, 6);
        expect(await quantity(outputProductId)).toBeCloseTo(3, 6);
        expect(await prisma.productCostHistory.count({
            where: { companyId, productionOrderId }
        })).toBe(0);
        const openingAfterCancel = await prisma.inventoryBatch.findFirst({
            where: { companyId, warehouseId, productId: outputProductId, sourceRef: openingSourceRef }
        });
        const productionAfterCancel = await prisma.inventoryBatch.findFirst({
            where: { companyId, warehouseId, productId: outputProductId, sourceRef: `PROD-${productionOrderId}` }
        });
        expect(Number(openingAfterCancel?.remainingQty)).toBeCloseTo(3, 6);
        expect(Number(productionAfterCancel?.remainingQty)).toBeCloseTo(0, 6);
        const restoredOutput = await prisma.product.findUnique({ where: { id: outputProductId } });
        expect(Number(restoredOutput?.currentAverageCost)).toBeCloseTo(7, 6);

        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `PROD-${productionOrderId}` },
            select: { productId: true, type: true, quantity: true }
        });
        for (const productId of [productionIngredientId, outputProductId]) {
            const net = movements
                .filter((movement) => movement.productId === productId)
                .reduce(
                    (sum, movement) => sum + (movement.type === 'IN' ? Number(movement.quantity) : -Number(movement.quantity)),
                    0
                );
            expect(net).toBeCloseTo(0, 6);
        }
    });

    it('backs up, dry-runs and idempotently removes an isolated DEMO-CYCLE graph', async () => {
        const sharedReferenceCost = 91;
        const sharedProduct = await prisma.product.create({
            data: {
                companyId,
                categoryId,
                name: `Shared cost reference ${suffix}`,
                sku: `SHARED-COST-${suffix}`,
                unit: 'g',
                baseUnitId: gramUnitId,
                type: 'INGREDIENT',
                cost: sharedReferenceCost,
                currentAverageCost: 7,
                lastPurchaseCost: 0
            }
        });
        const sharedProduction = await prisma.productionOrder.create({
            data: {
                companyId,
                branchId,
                code: `DEMO-COST-${suffix}`,
                productId: sharedProduct.id,
                warehouseId,
                status: 'FINISHED',
                plannedQuantity: 1,
                producedQuantity: 1,
                userId,
                notes: `DEMO-CYCLE shared cost fixture ${suffix}`
            }
        });
        await prisma.productCostHistory.create({
            data: {
                companyId,
                productId: sharedProduct.id,
                productionOrderId: sharedProduction.id,
                quantity: 1,
                unitCost: 7,
                previousAvgCost: 2,
                newAvgCost: 7,
                previousStock: 0,
                newStock: 1
            }
        });

        const demoProduct = await prisma.product.create({
            data: {
                companyId,
                categoryId,
                name: 'DEMO-CYCLE Integration Ingredient',
                sku: `DEMO-CYCLE-IT-${suffix}`,
                unit: 'g',
                baseUnitId: gramUnitId,
                type: 'INGREDIENT',
                cost: 3,
                currentAverageCost: 3
            }
        });
        await prisma.stock.create({
            data: { companyId, warehouseId, productId: demoProduct.id, quantity: 5 }
        });
        await prisma.inventoryMovement.create({
            data: {
                companyId,
                warehouseId,
                productId: demoProduct.id,
                userId,
                type: 'IN',
                quantity: 5,
                unitCost: 3,
                totalCost: 15,
                reference: `DEMO-CYCLE integration ${suffix}`,
                reason: 'Integration fixture'
            }
        });
        await prisma.inventoryBatch.create({
            data: {
                companyId,
                warehouseId,
                productId: demoProduct.id,
                unitCost: 3,
                originalQty: 5,
                remainingQty: 5,
                sourceType: 'ADJUSTMENT',
                sourceRef: `DEMO-CYCLE integration ${suffix}`
            }
        });
        const demoMenu = await prisma.menuItem.create({
            data: {
                companyId,
                branchId,
                categoryId,
                name: `DEMO-CYCLE Integration Menu ${suffix}`,
                price: 1,
                type: 'PREPARED',
                recipes: {
                    create: {
                        productId: demoProduct.id,
                        quantity: 1,
                        unit: 'g',
                        unitId: gramUnitId
                    }
                }
            }
        });

        const dryBackup = path.join(os.tmpdir(), `demo-cleanup-dry-${suffix}.json`);
        const applyBackup = path.join(os.tmpdir(), `demo-cleanup-apply-${suffix}.json`);
        try {
            const dry = await runDemoCleanup({
                companyId,
                out: dryBackup,
                apply: false
            });
            expect(dry.applied).toBe(false);
            expect('blockers' in dry ? dry.blockers : []).toEqual([]);
            expect((await fs.stat(dryBackup)).size).toBeGreaterThan(100);
            expect(await prisma.product.findUnique({ where: { id: demoProduct.id } })).not.toBeNull();

            const previousGuard = process.env.ALLOW_DEMO_CLEANUP;
            process.env.ALLOW_DEMO_CLEANUP = '1';
            try {
                const applied = await runDemoCleanup({
                    companyId,
                    out: applyBackup,
                    apply: true,
                    confirmCompany: `Recipe E2E ${suffix}`
                });
                expect(applied.applied).toBe(true);
            } finally {
                if (previousGuard === undefined) delete process.env.ALLOW_DEMO_CLEANUP;
                else process.env.ALLOW_DEMO_CLEANUP = previousGuard;
            }

            expect(await prisma.product.findUnique({ where: { id: demoProduct.id } })).toBeNull();
            expect(await prisma.menuItem.findUnique({ where: { id: demoMenu.id } })).toBeNull();
            const restoredShared = await prisma.product.findUnique({ where: { id: sharedProduct.id } });
            expect(Number(restoredShared?.currentAverageCost)).toBeCloseTo(2, 6);
            expect(Number(restoredShared?.cost)).toBeCloseTo(sharedReferenceCost, 6);
            expect((await fs.stat(applyBackup)).size).toBeGreaterThan(100);

            // A new dry-run after cleanup sees an empty graph, proving idempotency.
            const idempotentBackup = path.join(os.tmpdir(), `demo-cleanup-empty-${suffix}.json`);
            try {
                const empty = await runDemoCleanup({ companyId, out: idempotentBackup, apply: false });
                if (!('counts' in empty)) throw new Error('Expected dry-run cleanup result.');
                expect(empty.counts.products).toBe(0);
                expect(empty.counts.menuItems).toBe(0);
                expect(empty.counts.inventoryMovements).toBe(0);
            } finally {
                await fs.rm(idempotentBackup, { force: true });
            }
        } finally {
            await fs.rm(dryBackup, { force: true });
            await fs.rm(applyBackup, { force: true });
        }
    });

    it('allows exactly one concurrent production finish and never double-consumes stock', async () => {
        expect(await quantity(productionIngredientId)).toBeCloseTo(100, 6);
        expect(await quantity(outputProductId)).toBeCloseTo(3, 6);

        const order = await ProductionOrderService.create(
            companyId,
            {
                productId: outputProductId,
                recipeId: productionRecipeId,
                plannedQuantity: 4,
                warehouseId,
                branchId,
                status: 'PENDING'
            },
            userId
        );
        await ProductionOrderService.setStatus(order.id, companyId, 'IN_PROGRESS', userId);

        const attempts = await Promise.allSettled([
            ProductionOrderService.finish(order.id, companyId, userId, { producedQuantity: 4 }),
            ProductionOrderService.finish(order.id, companyId, userId, { producedQuantity: 4 })
        ]);
        const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
        const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        expect(await quantity(productionIngredientId)).toBeCloseTo(80, 6);
        expect(await quantity(outputProductId)).toBeCloseTo(7, 6);
        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `PROD-${order.id}` },
            select: { productId: true, type: true, quantity: true }
        });
        expect(movements.filter((movement) => movement.type === 'OUT')).toHaveLength(1);
        expect(movements.filter((movement) => movement.type === 'IN')).toHaveLength(1);
        expect(
            movements
                .filter((movement) => movement.productId === productionIngredientId && movement.type === 'OUT')
                .reduce((sum, movement) => sum + Number(movement.quantity), 0)
        ).toBeCloseTo(20, 6);
        expect(
            movements
                .filter((movement) => movement.productId === outputProductId && movement.type === 'IN')
                .reduce((sum, movement) => sum + Number(movement.quantity), 0)
        ).toBeCloseTo(4, 6);
        expect(await prisma.productCostHistory.count({
            where: { companyId, productionOrderId: order.id }
        })).toBe(1);

        const openingBeforeCancel = await prisma.inventoryBatch.findFirst({
            where: {
                companyId,
                warehouseId,
                productId: outputProductId,
                sourceRef: `OPENING-RECIPE-E2E-${suffix}`
            }
        });
        const producedBeforeCancel = await prisma.inventoryBatch.findFirst({
            where: { companyId, warehouseId, productId: outputProductId, sourceRef: `PROD-${order.id}` }
        });
        expect(Number(openingBeforeCancel?.remainingQty)).toBeCloseTo(3, 6);
        expect(Number(producedBeforeCancel?.remainingQty)).toBeCloseTo(4, 6);

        await ProductionOrderService.cancel(order.id, companyId, userId, 'Concurrent finish rollback');
        expect(await quantity(productionIngredientId)).toBeCloseTo(100, 6);
        expect(await quantity(outputProductId)).toBeCloseTo(3, 6);
        expect(await prisma.productCostHistory.count({
            where: { companyId, productionOrderId: order.id }
        })).toBe(0);

        const openingAfterCancel = await prisma.inventoryBatch.findFirst({
            where: {
                companyId,
                warehouseId,
                productId: outputProductId,
                sourceRef: `OPENING-RECIPE-E2E-${suffix}`
            }
        });
        const producedAfterCancel = await prisma.inventoryBatch.findFirst({
            where: { companyId, warehouseId, productId: outputProductId, sourceRef: `PROD-${order.id}` }
        });
        expect(Number(openingAfterCancel?.remainingQty)).toBeCloseTo(3, 6);
        expect(Number(producedAfterCancel?.remainingQty)).toBeCloseTo(0, 6);
    });

    it('replays weighted cost with intervening OUT stock when an intact earlier production layer is cancelled', async () => {
        const ingredient = await prisma.product.create({
            data: {
                companyId,
                categoryId,
                name: `Replay ingredient ${suffix}`,
                sku: `RE2E-REPLAY-IN-${suffix}`,
                unit: 'g',
                baseUnitId: gramUnitId,
                type: 'INGREDIENT',
                cost: 7,
                currentAverageCost: 7
            }
        });
        const output = await prisma.product.create({
            data: {
                companyId,
                categoryId,
                name: `Replay output ${suffix}`,
                sku: `RE2E-REPLAY-OUT-${suffix}`,
                unit: 'unidad',
                baseUnitId: unitUnitId,
                type: 'INTERMEDIATE',
                cost: 5,
                currentAverageCost: 5
            }
        });
        await prisma.stock.createMany({
            data: [
                { companyId, warehouseId, productId: ingredient.id, quantity: 100 },
                { companyId, warehouseId, productId: output.id, quantity: 10 }
            ]
        });
        const openingSourceRef = `OPENING-REPLAY-${suffix}`;
        await prisma.inventoryBatch.create({
            data: {
                companyId,
                warehouseId,
                productId: output.id,
                unitCost: 5,
                originalQty: 10,
                remainingQty: 10,
                sourceType: 'OPENING',
                sourceRef: openingSourceRef
            }
        });
        const recipe = await ProductionRecipeService.create(
            companyId,
            {
                productId: output.id,
                name: `Replay recipe ${suffix}`,
                yieldQuantity: 10,
                yieldUnitId: unitUnitId,
                activate: true,
                components: [{
                    componentProductId: ingredient.id,
                    quantity: 10,
                    unitId: gramUnitId,
                    unit: 'g'
                }]
            },
            userId
        );

        // Baseline 10 @ 5; target production +10 @ 7 => average 6.
        const target = await ProductionOrderService.create(
            companyId,
            {
                productId: output.id,
                recipeId: recipe.id,
                plannedQuantity: 10,
                warehouseId,
                branchId,
                status: 'PENDING'
            },
            userId
        );
        await ProductionOrderService.setStatus(target.id, companyId, 'IN_PROGRESS', userId);
        await ProductionOrderService.finish(target.id, companyId, userId, { producedQuantity: 10 });
        expect(Number((await prisma.product.findUnique({ where: { id: output.id } }))?.currentAverageCost)).toBeCloseTo(6, 6);

        // Consume five from the older OPENING layer. The target PROD layer stays
        // completely intact, while observed stock before the next cost event is 15.
        await prisma.$transaction(async (tx) => {
            await InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId,
                warehouseId,
                productId: output.id,
                userId,
                quantity: 5,
                reason: 'Replay integration OUT',
                reference: `REPLAY-OUT-${suffix}`,
                productName: output.name
            });
        });
        expect(Number((await prisma.inventoryBatch.findFirst({
            where: { productId: output.id, sourceRef: openingSourceRef }
        }))?.remainingQty)).toBeCloseTo(5, 6);
        expect(Number((await prisma.inventoryBatch.findFirst({
            where: { productId: output.id, sourceRef: `PROD-${target.id}` }
        }))?.remainingQty)).toBeCloseTo(10, 6);

        // Later +5 @ 9 sees previousStock=15. Without the target layer, the
        // counterfactual previous stock is 5 and cost becomes (5*5 + 5*9)/10 = 7.
        await prisma.product.update({
            where: { id: ingredient.id },
            data: { currentAverageCost: 9, cost: 9 }
        });
        const later = await ProductionOrderService.create(
            companyId,
            {
                productId: output.id,
                recipeId: recipe.id,
                plannedQuantity: 5,
                warehouseId,
                branchId,
                status: 'PENDING'
            },
            userId
        );
        await ProductionOrderService.setStatus(later.id, companyId, 'IN_PROGRESS', userId);
        await ProductionOrderService.finish(later.id, companyId, userId, { producedQuantity: 5 });

        await ProductionOrderService.cancel(target.id, companyId, userId, 'Replay earlier intact layer');
        const restored = await prisma.product.findUnique({ where: { id: output.id } });
        const restoredStock = await prisma.stock.findUnique({
            where: { warehouseId_productId: { warehouseId, productId: output.id } }
        });
        expect(Number(restoredStock?.quantity)).toBeCloseTo(10, 6);
        expect(Number(restored?.currentAverageCost)).toBeCloseTo(7, 6);
        expect(await prisma.productCostHistory.count({
            where: { productionOrderId: target.id, companyId }
        })).toBe(0);
        expect(await prisma.productCostHistory.count({
            where: { productionOrderId: later.id, companyId }
        })).toBe(1);
        expect(Number((await prisma.inventoryBatch.findFirst({
            where: { productId: output.id, sourceRef: openingSourceRef }
        }))?.remainingQty)).toBeCloseTo(5, 6);
        expect(Number((await prisma.inventoryBatch.findFirst({
            where: { productId: output.id, sourceRef: `PROD-${target.id}` }
        }))?.remainingQty)).toBeCloseTo(0, 6);
        expect(Number((await prisma.inventoryBatch.findFirst({
            where: { productId: output.id, sourceRef: `PROD-${later.id}` }
        }))?.remainingQty)).toBeCloseTo(5, 6);
    });

    it('restores every original FIFO input layer when finished production is cancelled', async () => {
        await prisma.company.update({ where: { id: companyId }, data: { costingMethod: 'FIFO' } });
        const [ingredient, output] = await Promise.all([
            prisma.product.create({
                data: {
                    companyId, categoryId, name: `FIFO cancel ingredient ${suffix}`,
                    sku: `FIFO-CANCEL-IN-${suffix}`, unit: 'g', baseUnitId: gramUnitId,
                    type: 'INGREDIENT', cost: 5, currentAverageCost: 5
                }
            }),
            prisma.product.create({
                data: {
                    companyId, categoryId, name: `FIFO cancel output ${suffix}`,
                    sku: `FIFO-CANCEL-OUT-${suffix}`, unit: 'unidad', baseUnitId: unitUnitId,
                    type: 'INTERMEDIATE', cost: 1, currentAverageCost: 1
                }
            })
        ]);
        await prisma.stock.createMany({ data: [
            { companyId, warehouseId, productId: ingredient.id, quantity: 10 },
            { companyId, warehouseId, productId: output.id, quantity: 0 }
        ] });
        const firstDate = new Date('2025-01-01T00:00:00.000Z');
        const secondDate = new Date('2025-02-01T00:00:00.000Z');
        await prisma.inventoryBatch.createMany({ data: [
            {
                companyId, warehouseId, productId: ingredient.id, unitCost: 2,
                originalQty: 5, remainingQty: 5, sourceType: 'PURCHASE',
                sourceRef: `FIFO-PO-A-${suffix}`, createdAt: firstDate
            },
            {
                companyId, warehouseId, productId: ingredient.id, unitCost: 8,
                originalQty: 5, remainingQty: 5, sourceType: 'PURCHASE',
                sourceRef: `FIFO-PO-B-${suffix}`, createdAt: secondDate
            }
        ] });
        const recipe = await ProductionRecipeService.create(companyId, {
            productId: output.id,
            name: `FIFO cancel recipe ${suffix}`,
            yieldQuantity: 1,
            yieldUnitId: unitUnitId,
            activate: true,
            components: [{
                componentProductId: ingredient.id,
                quantity: 6,
                unitId: gramUnitId,
                unit: 'g'
            }]
        }, userId);
        const order = await ProductionOrderService.create(companyId, {
            productId: output.id,
            recipeId: recipe.id,
            plannedQuantity: 1,
            warehouseId,
            branchId,
            status: 'PENDING'
        }, userId);
        await ProductionOrderService.setStatus(order.id, companyId, 'IN_PROGRESS', userId);

        const finished = await ProductionOrderService.finish(order.id, companyId, userId, {});
        expect(Number(finished.realCost)).toBeCloseTo(18, 6); // 5@2 + 1@8
        const saved = await prisma.productionOrderItem.findFirstOrThrow({
            where: { productionOrderId: order.id }
        });
        expect(Array.isArray(saved.consumedLayers)).toBe(true);

        await ProductionOrderService.cancel(order.id, companyId, userId, 'Exact FIFO rollback');
        const restored = await prisma.inventoryBatch.groupBy({
            by: ['sourceRef'],
            where: {
                companyId, warehouseId, productId: ingredient.id,
                sourceRef: { in: [`FIFO-PO-A-${suffix}`, `FIFO-PO-B-${suffix}`] }
            },
            _sum: { remainingQty: true }
        });
        const byRef = new Map(restored.map((row) => [row.sourceRef, Number(row._sum.remainingQty)]));
        expect(byRef.get(`FIFO-PO-A-${suffix}`)).toBeCloseTo(5, 6);
        expect(byRef.get(`FIFO-PO-B-${suffix}`)).toBeCloseTo(5, 6);
        expect(await quantity(ingredient.id)).toBeCloseTo(10, 6);
        expect(await quantity(output.id)).toBeCloseTo(0, 6);

        await prisma.company.update({ where: { id: companyId }, data: { costingMethod: 'WEIGHTED_AVERAGE' } });
    });
});
