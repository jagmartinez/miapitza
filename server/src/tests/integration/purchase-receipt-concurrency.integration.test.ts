import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { WasteReportService } from '../../services/waste-report.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';

describe('Purchase receipt concurrency and base-unit costing (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
    let companyId: number;
    let branchId: number;
    let roleId: number;
    let userId: number;
    let categoryId: number;
    let warehouseId: number;
    let supplierId: number;
    let gramId: number;
    let kilogramId: number;
    let productId: number;
    let purchaseOrderId: number;

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: `PO concurrency ${suffix}`, costingMethod: 'WEIGHTED_AVERAGE' }
        });
        companyId = company.id;
        const branch = await prisma.branch.create({
            data: { companyId, name: `Branch ${suffix}`, code: `POC-${suffix}` }
        });
        branchId = branch.id;
        const role = await prisma.role.create({ data: { companyId, name: `PO_ROLE_${suffix}` } });
        roleId = role.id;
        const user = await prisma.user.create({
            data: {
                companyId, branchId, roleId, name: 'PO test user',
                email: `po-${suffix}@example.test`, username: `po_${suffix}`,
                password: 'integration-only', mustChangePassword: false, status: 'ACTIVE'
            }
        });
        userId = user.id;
        const category = await prisma.category.create({
            data: { companyId, name: `PO category ${suffix}`, codePrefix: `P${companyId}`, showInInventory: true }
        });
        categoryId = category.id;
        const warehouse = await prisma.warehouse.create({
            data: { companyId, branchId, name: `PO warehouse ${suffix}`, code: `POW-${suffix}` }
        });
        warehouseId = warehouse.id;
        const supplier = await prisma.supplier.create({ data: { companyId, name: `PO supplier ${suffix}` } });
        supplierId = supplier.id;
        const gram = await prisma.unitOfMeasure.create({
            data: { companyId, name: 'Gramo', abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 }
        });
        gramId = gram.id;
        const kilogram = await prisma.unitOfMeasure.create({
            data: { companyId, name: 'Kilogramo', abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 }
        });
        kilogramId = kilogram.id;
        const product = await prisma.product.create({
            data: {
                companyId, categoryId, name: `Flour ${suffix}`, sku: `FLOUR-${suffix}`,
                unit: 'g', baseUnitId: gramId, type: 'INGREDIENT', cost: 0,
                currentAverageCost: 0
            }
        });
        productId = product.id;
        await prisma.productUnit.createMany({ data: [
            { companyId, productId, unitId: gramId, conversionFactor: 1, isDefault: false },
            { companyId, productId, unitId: kilogramId, conversionFactor: 1000, isDefault: true }
        ] });

        const po = await PurchaseOrderService.create(companyId, {
            branchId, supplierId, invoiceType: 'CREDIT',
            items: [{ productId, quantity: 2.5, cost: 750, purchaseUnit: 'kg' }]
        });
        purchaseOrderId = po!.id;
        await PurchaseOrderService.update(purchaseOrderId, companyId, { status: 'ISSUED' });
    });

    afterAll(async () => {
        if (!companyId) return;
        await prisma.productCostHistory.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { companyId } } });
        await prisma.purchaseOrder.deleteMany({ where: { companyId } });
        await prisma.productUnit.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.unitOfMeasure.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.supplier.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    it('commits exactly one of two simultaneous receipts and preserves conversion math', async () => {
        const results = await Promise.allSettled([
            PurchaseOrderService.receive(purchaseOrderId, companyId, userId, warehouseId),
            PurchaseOrderService.receive(purchaseOrderId, companyId, userId, warehouseId)
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

        const [po, item, stock, movements, batches, histories, product] = await Promise.all([
            prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } }),
            prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId } }),
            prisma.stock.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } }),
            prisma.inventoryMovement.findMany({ where: { companyId, reference: `PO-${purchaseOrderId}` } }),
            prisma.inventoryBatch.findMany({ where: { companyId, sourceRef: `PO-${purchaseOrderId}` } }),
            prisma.productCostHistory.findMany({ where: { companyId, purchaseOrderItemId: { not: null } } }),
            prisma.product.findUniqueOrThrow({ where: { id: productId } })
        ]);

        // 2.5 kg × 1000 g/kg = 2500 g; C$750/kg ÷ 1000 = C$0.75/g.
        expect(po?.status).toBe('RECEIVED');
        expect(Number(item.conversionFactor)).toBe(1000);
        expect(Number(item.baseQuantity)).toBe(2500);
        expect(Number(item.baseCost)).toBeCloseTo(0.75, 6);
        expect(Number(stock?.quantity)).toBe(2500);
        expect(movements).toHaveLength(1);
        expect(Number(movements[0].quantity)).toBe(2500);
        expect(Number(movements[0].unitCost)).toBeCloseTo(0.75, 6);
        expect(Number(movements[0].totalCost)).toBeCloseTo(1875, 6);
        expect(batches).toHaveLength(1);
        expect(Number(batches[0].remainingQty)).toBe(2500);
        expect(Number(batches[0].unitCost)).toBeCloseTo(0.75, 6);
        expect(histories).toHaveLength(1);
        expect(Number(product.currentAverageCost)).toBeCloseTo(0.75, 6);
    });

    it('does not lose or overbook concurrent credit payments', async () => {
        // Total is C$1,875. Two stale C$1,000 writes cannot both commit because
        // 1,000 + 1,000 > 1,875; optimistic paidAmount claim permits exactly one.
        const results = await Promise.allSettled([
            PurchaseOrderService.addPayment(purchaseOrderId, companyId, { amount: 1000 }),
            PurchaseOrderService.addPayment(purchaseOrderId, companyId, { amount: 1000 })
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

        const [po, payments] = await Promise.all([
            prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } }),
            prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId } })
        ]);
        expect(payments).toHaveLength(1);
        expect(Number(payments[0].amount)).toBe(1000);
        expect(Number(po.paidAmount)).toBe(1000);
        expect(po.paymentStatus).toBe('PARTIAL');
    });

    it('conserves FIFO value when transferring portions of multiple layers', async () => {
        await prisma.company.update({ where: { id: companyId }, data: { costingMethod: 'FIFO' } });
        const destination = await prisma.warehouse.create({
            data: { companyId, branchId, name: `FIFO destination ${suffix}`, code: `FIFOD-${suffix}` }
        });
        await prisma.$transaction(async (tx) => {
            await InventoryEngineService.applyMovement(tx, {
                type: 'IN', companyId, warehouseId, productId, userId,
                quantity: 1000, unitCost: 2, sourceType: 'ADJUSTMENT', reference: `OPEN-${suffix}`
            });
        });

        // Source layers: 2500 @ .75 and 1000 @ 2. Transfer 3000 consumes
        // 2500*.75 + 500*2 = 2875, so destination unit cost = 2875/3000.
        const result = await InventoryMovementService.transfer(companyId, {
            fromWarehouseId: warehouseId, toWarehouseId: destination.id,
            productId, userId, quantity: 3000
        });
        const movements = await prisma.inventoryMovement.findMany({
            where: { transferGroupId: result.transferGroupId }, orderBy: { id: 'asc' }
        });
        const destinationBatches = await prisma.inventoryBatch.findMany({
            where: { companyId, warehouseId: destination.id, productId, sourceType: 'TRANSFER' },
            orderBy: { id: 'asc' }
        });
        const expectedValue = 2500 * 0.75 + 500 * 2;
        expect(movements).toHaveLength(2);
        expect(Number(movements[0].totalCost)).toBeCloseTo(expectedValue, 6);
        expect(Number(movements[1].totalCost)).toBeCloseTo(expectedValue, 6);
        expect(destinationBatches.map((b) => [Number(b.originalQty), Number(b.unitCost)])).toEqual([
            [2500, 0.75], [500, 2]
        ]);
        const stocks = await prisma.stock.findMany({ where: { companyId, productId } });
        expect(stocks.reduce((sum, row) => sum + Number(row.quantity), 0)).toBeCloseTo(3500, 6);

        // Future COGS at destination must equal consuming the same portions at source.
        const futureOut = await prisma.$transaction((tx) => InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId, warehouseId: destination.id, productId, userId, quantity: 3000
        }));
        expect(futureOut.totalCost).toBeCloseTo(expectedValue, 6);
    });

    it('records converted waste as a valued inventory outflow and reconciles its report', async () => {
        const movement = await WasteReportService.recordWaste(companyId, {
            warehouseId,
            productId,
            userId,
            quantity: 0.5,
            unit: 'kg',
            reason: 'Derrame',
            notes: 'certification-waste',
        });
        expect(Number(movement?.quantity)).toBe(500);
        expect(Number(movement?.unitCost)).toBeCloseTo(2, 6);
        expect(Number(movement?.totalCost)).toBeCloseTo(1000, 6);
        const report = await WasteReportService.getWasteReport(companyId, { productId, warehouseId });
        expect(report.summary.totalEntries).toBe(1);
        expect(report.summary.quantities).toEqual([{ unit: 'g', quantity: 500 }]);
        expect(report.summary.totalCost).toBe(1000);
        expect(report.byReason).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'Derrame', unit: 'g', quantity: 500, cost: 1000 })
        ]));
        expect(Number((await prisma.stock.findUniqueOrThrow({
            where: { warehouseId_productId: { warehouseId, productId } }
        })).quantity)).toBe(0);
    });
});
