import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { AuditLogService } from '../../services/audit-log.service';
import { CostingService } from '../../services/costing.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('InventoryMovementService valued manual entries', () => {
    it('rejects a caller-supplied cost on OUT instead of overriding the costing method', async () => {
        jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, unit: 'kg', baseUnit: { abbreviation: 'kg' }
        } as never);

        await expect(InventoryMovementService.create(1, {
            warehouseId: 2,
            productId: 7,
            userId: 9,
            type: 'OUT',
            quantity: 1,
            unitCost: 999,
            reason: 'Ajuste de prueba'
        })).rejects.toThrow(/costo de una salida.*método de costeo/i);
    });

    it('converts an omitted unit explicitly and folds a valued IN into moving average atomically', async () => {
        jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, unit: 'kg', baseUnit: { abbreviation: 'g' }
        } as never);
        const convert = jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 2_000,
            conversionFactor: 1,
            originalQuantity: 2_000,
            originalUnit: 'g',
            baseUnit: 'g'
        });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            stock: { aggregate: jest.fn(async () => ({ _sum: { quantity: 500 } })) },
            inventoryMovement: { findUnique: jest.fn(async () => ({ id: 44 })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const engine = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 44,
            unitCost: 0.025,
            totalCost: 50,
            balanceQty: 2_000,
            balanceCost: 50
        });
        const costing = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await InventoryMovementService.create(1, {
            warehouseId: 2,
            productId: 7,
            userId: 9,
            type: 'IN',
            quantity: 2_000,
            unitCost: 0.025,
            reason: 'Conteo físico inicial'
        });

        expect(convert).toHaveBeenCalledWith(7, 1, 2_000, 'g');
        expect(engine).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            quantity: 2_000,
            unitCost: 0.025,
            originalUnit: 'g',
            conversionFactor: 1,
            reason: 'Conteo físico inicial'
        }));
        expect(costing).toHaveBeenCalledWith(tx as never, 7, 1, 2_000, 0.025, 500, undefined, 44);
    });

    it('records an implicit-cost MANUAL IN so a later reversal can replay subsequent receipts', async () => {
        jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, unit: 'kg', baseUnit: { abbreviation: 'kg' }
        } as never);
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 2, conversionFactor: 1, originalQuantity: 2,
            originalUnit: 'kg', baseUnit: 'kg'
        });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            stock: { aggregate: jest.fn(async () => ({ _sum: { quantity: 10 } })) },
            inventoryMovement: { findUnique: jest.fn(async () => ({ id: 45 })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 45, unitCost: 5, totalCost: 10, balanceQty: 12, balanceCost: 60
        });
        const costing = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await InventoryMovementService.create(1, {
            warehouseId: 2, productId: 7, userId: 9, type: 'IN', quantity: 2,
            reason: 'Conteo fisico confirmado'
        });

        expect(costing).toHaveBeenCalledWith(tx as never, 7, 1, 2, 5, 10, undefined, 45);
    });
});
