import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { AuditLogService } from '../../services/audit-log.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { WasteReportService } from '../../services/waste-report.service';

describe('Inventory immutable reversal certification (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
    let companyId: number;
    let otherCompanyId: number;
    let branchAId: number;
    let branchBId: number;
    let warehouseAId: number;
    let warehouseBId: number;
    let userId: number;

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: `Inventory reversal ${suffix}`, costingMethod: 'WEIGHTED_AVERAGE' }
        });
        companyId = company.id;
        const other = await prisma.company.create({ data: { name: `Other tenant ${suffix}` } });
        otherCompanyId = other.id;
        const [branchA, branchB] = await Promise.all([
            prisma.branch.create({ data: { companyId, name: `Branch A ${suffix}`, code: `IRA-${suffix}` } }),
            prisma.branch.create({ data: { companyId, name: `Branch B ${suffix}`, code: `IRB-${suffix}` } })
        ]);
        branchAId = branchA.id;
        branchBId = branchB.id;
        const role = await prisma.role.create({ data: { companyId, name: `INV_REV_${suffix}` } });
        const user = await prisma.user.create({
            data: {
                companyId, branchId: branchAId, roleId: role.id, name: 'Inventory reverser',
                email: `inventory-reversal-${suffix}@example.test`, username: `inv_rev_${suffix}`,
                password: 'integration-only', mustChangePassword: false, status: 'ACTIVE'
            }
        });
        userId = user.id;
        const [warehouseA, warehouseB] = await Promise.all([
            prisma.warehouse.create({
                data: { companyId, branchId: branchAId, name: `Warehouse A ${suffix}`, code: `IRWA-${suffix}` }
            }),
            prisma.warehouse.create({
                data: { companyId, branchId: branchBId, name: `Warehouse B ${suffix}`, code: `IRWB-${suffix}` }
            })
        ]);
        warehouseAId = warehouseA.id;
        warehouseBId = warehouseB.id;
    });

    afterAll(async () => {
        if (!companyId) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.productCostHistory.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId, reversalOfId: { not: null } } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
        await prisma.company.delete({ where: { id: otherCompanyId } });
    });

    async function product(label: string) {
        return prisma.product.create({
            data: {
                companyId, name: `${label} ${suffix}`, sku: `${label}-${suffix}`, unit: 'unit',
                cost: 5, referenceCostKnown: true,
                currentAverageCost: 5, averageCostKnown: true,
                type: 'INGREDIENT'
            }
        });
    }

    async function stock(warehouseId: number, productId: number): Promise<number> {
        const row = await prisma.stock.findUnique({
            where: { warehouseId_productId: { warehouseId, productId } }
        });
        return Number(row?.quantity ?? 0);
    }

    it('rolls back movement, stock and cost history when the transactional audit fails', async () => {
        const item = await product('AUDIT-ROLLBACK');
        const audit = jest.spyOn(AuditLogService, 'log')
            .mockRejectedValueOnce(new Error('forced audit failure'));

        await expect(InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId,
            productId: item.id,
            userId,
            type: 'IN',
            quantity: 3,
            unitCost: 5,
            reason: 'Audit rollback fixture'
        })).rejects.toThrow('forced audit failure');
        audit.mockRestore();

        expect(await stock(warehouseAId, item.id)).toBe(0);
        expect(await prisma.inventoryMovement.count({
            where: { companyId, productId: item.id }
        })).toBe(0);
        expect(await prisma.productCostHistory.count({
            where: { companyId, productId: item.id }
        })).toBe(0);
    });

    it('reverses MANUAL OUT after a later receipt and reconciles WA value chronologically', async () => {
        const item = await product('MANUAL-OUT');
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 10, unitCost: 5, reason: 'Initial valued stock'
        });
        const outgoing = await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'OUT',
            quantity: 2, reason: 'Manual count correction'
        });
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 2, unitCost: 10, reason: 'Later valued receipt'
        });
        expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: item.id } })).currentAverageCost))
            .toBeCloseTo(6, 6);

        const reversed = await InventoryMovementService.reverse(companyId, outgoing!.id, {
            userId, reason: 'Manual out was incorrect', reversalKey: `manual-out-${suffix}`, branchId: branchAId
        });

        expect(reversed.idempotent).toBe(false);
        expect(await stock(warehouseAId, item.id)).toBe(12);
        const updated = await prisma.product.findUniqueOrThrow({ where: { id: item.id } });
        expect(Number(updated.currentAverageCost)).toBeCloseTo(70 / 12, 6);
        const reversal = await prisma.inventoryMovement.findFirstOrThrow({
            where: { companyId, reversalOfId: outgoing!.id }
        });
        expect(Number(reversal.totalCost)).toBeCloseTo(Number(outgoing!.totalCost), 6);
        expect(reversal.direction).toBe('IN');
        expect(await prisma.productCostHistory.findUnique({ where: { inventoryMovementId: reversal.id } }))
            .toEqual(expect.objectContaining({ reversedAt: null }));
    });

    it('reverses implicit-cost MANUAL IN and replays a later receipt without deleting history', async () => {
        const item = await product('MANUAL-IN');
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 10, unitCost: 5, reason: 'Initial valued stock'
        });
        const manualIn = await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 2, reason: 'Implicit average count increase'
        });
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 2, unitCost: 10, reason: 'Later valued receipt'
        });

        const result = await InventoryMovementService.reverse(companyId, manualIn!.id, {
            userId, reason: 'Count increase was incorrect', reversalKey: `manual-in-${suffix}`, branchId: branchAId
        });

        expect(result.idempotent).toBe(false);
        expect(await stock(warehouseAId, item.id)).toBe(12);
        expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: item.id } })).currentAverageCost))
            .toBeCloseTo(70 / 12, 6);
        const costEvent = await prisma.productCostHistory.findUniqueOrThrow({
            where: { inventoryMovementId: manualIn!.id }
        });
        expect(costEvent.reversedAt).not.toBeNull();
        expect(costEvent.reversalMovementId).not.toBeNull();
    });

    it('nets WASTE confirmation/reversal in stock, layers, cost and report', async () => {
        const item = await product('WASTE');
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 10, unitCost: 5, reason: 'Initial valued stock'
        });
        const waste = await WasteReportService.recordWaste(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId,
            quantity: 2, reason: 'Deterioro'
        });
        await InventoryMovementService.reverse(companyId, waste!.id, {
            userId, reason: 'Waste record duplicated', reversalKey: `waste-${suffix}`, branchId: branchAId
        });

        const [report, batches] = await Promise.all([
            WasteReportService.getWasteReport(companyId, { productId: item.id, warehouseId: warehouseAId }),
            prisma.inventoryBatch.findMany({ where: { companyId, productId: item.id, warehouseId: warehouseAId } })
        ]);
        expect(await stock(warehouseAId, item.id)).toBe(10);
        expect(batches.reduce((sum, batch) => sum + Number(batch.remainingQty), 0)).toBeCloseTo(10, 6);
        expect(batches.reduce((sum, batch) => sum + Number(batch.remainingQty) * Number(batch.unitCost), 0))
            .toBeCloseTo(50, 6);
        expect(report.summary).toEqual(expect.objectContaining({
            totalEntries: 1, reversedEntries: 1, netEntries: 0, totalCost: 0
        }));
        expect(report.summary.quantities).toEqual([{ unit: 'unit', quantity: 0 }]);
    });

    it('reverses both TRANSFER legs, enforces branch/tenant, and deduplicates concurrent retries', async () => {
        const item = await product('TRANSFER');
        await InventoryMovementService.create(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId, type: 'IN',
            quantity: 10, unitCost: 5, reason: 'Initial valued stock'
        });
        const transfer = await InventoryMovementService.transfer(companyId, {
            fromWarehouseId: warehouseAId, toWarehouseId: warehouseBId,
            productId: item.id, userId, quantity: 3
        });
        const transferMovement = await prisma.inventoryMovement.findFirstOrThrow({
            where: { companyId, transferGroupId: transfer.transferGroupId }
        });

        await expect(InventoryMovementService.reverse(companyId, transferMovement.id, {
            userId, reason: 'Wrong destination branch', reversalKey: `transfer-branch-${suffix}`, branchId: branchAId
        })).rejects.toThrow(/otra sucursal/i);
        await expect(InventoryMovementService.reverse(otherCompanyId, transferMovement.id, {
            userId, reason: 'Cross tenant attempt', reversalKey: `transfer-tenant-${suffix}`
        })).rejects.toThrow(/no encontrado/i);

        await InventoryMovementService.reverse(companyId, transferMovement.id, {
            userId, reason: 'Transfer destination was incorrect', reversalKey: `transfer-${suffix}`
        });
        expect(await stock(warehouseAId, item.id)).toBe(10);
        expect(await stock(warehouseBId, item.id)).toBe(0);
        expect(await prisma.inventoryMovement.count({
            where: { companyId, reversalGroupId: { startsWith: 'REV-' }, reversalOfId: { not: null }, productId: item.id }
        })).toBe(2);

        const waste = await WasteReportService.recordWaste(companyId, {
            warehouseId: warehouseAId, productId: item.id, userId,
            quantity: 1, reason: 'Prueba concurrente'
        });
        const key = `concurrent-waste-${suffix}`;
        const concurrent = await Promise.allSettled([
            InventoryMovementService.reverse(companyId, waste!.id, {
                userId, reason: 'Concurrent duplicate', reversalKey: key, branchId: branchAId
            }),
            InventoryMovementService.reverse(companyId, waste!.id, {
                userId, reason: 'Concurrent duplicate', reversalKey: key, branchId: branchAId
            })
        ]);
        expect(concurrent.some((entry) => entry.status === 'fulfilled')).toBe(true);
        expect(await prisma.inventoryMovement.count({ where: { companyId, reversalOfId: waste!.id } })).toBe(1);
        const retry = await InventoryMovementService.reverse(companyId, waste!.id, {
            userId, reason: 'Concurrent duplicate', reversalKey: key, branchId: branchAId
        });
        expect(retry.idempotent).toBe(true);
        expect(await stock(warehouseAId, item.id)).toBe(10);
    });
});
