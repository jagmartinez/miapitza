import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';

import {
    CateringService,
    describeCateringShortages,
    normalizeCateringLineAmount,
    type CateringInventoryShortage,
} from '../../services/catering.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { NEGATIVE_SALE_STOCK_ACTION } from '../../services/stock-alert.service';
import { WarehouseRouteService } from '../../services/warehouse-route.service';
import prisma from '../../utils/prisma';
import {
    CateringFiscalService,
    deserializeCateringInvoiceSnapshot,
    lineSubtotalMatches,
} from '../../services/catering-fiscal.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { CostingService } from '../../services/costing.service';
import { makeInventoryLedger } from './support/fake-inventory-ledger';

afterEach(() => { jest.restoreAllMocks(); });

describe('normalizeCateringLineAmount', () => {
    it('rounds the line subtotal half-up to cents with exact decimals', () => {
        const line = normalizeCateringLineAmount('1.01', '18.50', 'SERVICE');
        expect(line.subtotal.toString()).toBe('18.69'); // 18.685 -> 18.69
        expect(normalizeCateringLineAmount(120, 57.5, 'MENU_ITEM').subtotal.toString()).toBe('6900');
    });

    it('rejects amounts the DECIMAL(10,2) columns would silently round', () => {
        expect(() => normalizeCateringLineAmount(3, '10.555', 'MENU_ITEM')).toThrow(/dos decimales/);
        expect(() => normalizeCateringLineAmount('1.333', 10, 'SERVICE')).toThrow(/dos decimales/);
        expect(() => normalizeCateringLineAmount(2.5, 10, 'MENU_ITEM')).toThrow(/entero mayor a 0/);
        expect(() => normalizeCateringLineAmount(0, 10, 'SERVICE')).toThrow(/mayor a 0/);
        expect(() => normalizeCateringLineAmount(1, -1, 'SERVICE')).toThrow(/negativo/);
        expect(() => normalizeCateringLineAmount('abc', 1, 'SERVICE')).toThrow(/no son válidos/);
    });

    it('event total = sum of rounded line subtotals, so the invoice reconciles', () => {
        const lines = [
            normalizeCateringLineAmount('1.01', '18.50', 'SERVICE'),
            normalizeCateringLineAmount('2.5', '33.33', 'SERVICE'),
            normalizeCateringLineAmount(40, '12.75', 'MENU_ITEM'),
        ];
        const totalCents = lines.reduce((sum, line) => sum + line.subtotal.mul(100).toNumber(), 0);
        expect(totalCents).toBe(1869 + 8333 + 51000);
        for (const line of lines) {
            expect(lineSubtotalMatches(line.quantity.toNumber(), line.unitPrice.toNumber(), line.subtotal.mul(100).toNumber())).toBe(true);
        }
    });
});

describe('catering fiscal line reconciliation', () => {
    it('accepts exact half-up subtotals that float rounding rejected (1.01 x 18.50 = 18.69)', () => {
        expect(Math.round(1.01 * 18.5 * 100)).toBe(1868); // the old check
        expect(lineSubtotalMatches(1.01, 18.5, 1869)).toBe(true);
        expect(lineSubtotalMatches(1.01, 18.5, 1870)).toBe(false);

        const total = 18.69;
        const snapshot = {
            eventId: 9, invoiceNumber: 'FAC-1-000009', status: 'ISSUED', eventTitle: 'Coctel',
            eventDate: '2026-12-01T00:00:00.000Z', customerName: 'Cliente', companyName: 'Empresa',
            branchName: 'Principal', currencySymbol: 'C$',
            lines: [{ kind: 'SERVICE', sourceId: 3, name: 'Mesero por hora', quantity: 1.01, unitPrice: 18.5, subtotal: total }],
            subtotal: 16.25, tax: 2.44, taxRatePercent: 15, total,
            payments: [{ paymentId: 1, methodType: 'CASH', amount: total }],
            issuedAt: '2026-11-18T00:00:00.000Z', issuedById: 1, issuedByName: 'Admin',
        };
        expect(deserializeCateringInvoiceSnapshot(JSON.parse(JSON.stringify(snapshot)) as Prisma.JsonValue).total).toBe(18.69);
    });
});

type CateringPrivate = {
    deductInventoryTx(tx: unknown, eventId: number, companyId: number, userId: number, warehouseId: number): Promise<CateringInventoryShortage[]>;
};
type FiscalPrivate = {
    reverseFinishedInventory(tx: unknown, params: { eventId: number; companyId: number; userId: number; creditNoteNumber: string }): Promise<boolean>;
};

describe('catering inventory: finish deducts, full credit note returns (fake ledger)', () => {
    beforeEach(() => {
        jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
        jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);
        // 1 kg base unit; recipe lines in g convert /1000.
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (
            _productId: number, _companyId: number, quantity: number, unit: string
        ) => {
            if (unit === 'kg') return { baseQuantity: quantity, originalQuantity: null, originalUnit: null, conversionFactor: null };
            if (unit === 'g') return { baseQuantity: quantity / 1000, originalQuantity: quantity, originalUnit: 'g', conversionFactor: 0.001 };
            throw new Error(`Unidad no convertible: "${unit}"`);
        }) as never);
    });

    function setup(costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE', menuItems: unknown[]) {
        const ledger = makeInventoryLedger({ costingMethod, avgCost: 3 });
        const tx = ledger.tx as unknown as Record<string, unknown>;
        tx.cateringEvent = {
            findUnique: jest.fn(async () => ({ id: 5, branchId: 1, title: 'Boda', menuItems })),
        };
        tx.cateringMenuItem = {
            count: jest.fn(async () => menuItems.filter((line) =>
                ((line as { menuItem: { recipes: unknown[] } }).menuItem.recipes.length > 0)).length),
        };
        // The finish path only accepts a BRANCH warehouse of the event branch.
        (tx.warehouse as { findFirst: unknown }).findFirst = jest.fn(async ({ where }: { where: { id: number; branchId?: number; type?: string } }) =>
            where.id === 1 && (where.branchId === undefined || where.branchId === 1) ? { id: 1, companyId: 1, branchId: 1, type: 'BRANCH' } : null);
        return { ledger, tx };
    }

    const plate = (recipeOverrides: Record<string, unknown>, quantity: number) => ({
        quantity,
        menuItem: {
            recipes: [{
                productId: 1, quantity: 250, unit: '  ', unitOfMeasure: { abbreviation: 'g' },
                product: { name: 'Lomo', unit: 'lb', baseUnit: { abbreviation: 'kg' } },
                ...recipeOverrides,
            }],
        },
    });

    it.each(['FIFO', 'WEIGHTED_AVERAGE'] as const)('%s: deducts recipe x dishes once and returns it exactly', async (method) => {
        const { ledger, tx } = setup(method, [plate({}, 40)]);
        const { InventoryEngineService } = await import('../../services/inventory-engine.service');
        await InventoryEngineService.applyMovement(tx as never, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 1, userId: 9, quantity: 20, unitCost: 3, reference: 'PO-1', sourceType: 'PURCHASE',
        });

        const catering = CateringService as unknown as CateringPrivate;
        // Blank recipe.unit falls through to unitOfMeasure "g" (canonical resolveRecipeUnit).
        await catering.deductInventoryTx(tx, 5, 1, 9, 1);
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(10, 6); // 40 x 250 g = 10 kg
        await catering.deductInventoryTx(tx, 5, 1, 9, 1); // idempotent re-run
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(10, 6);
        const out = ledger.movements.filter((m) => m.reference === 'EVT-5' && m.type === 'OUT');
        expect(out).toHaveLength(1);
        expect(Number(out[0].totalCost)).toBeCloseTo(30, 6);

        const fiscal = CateringFiscalService as unknown as FiscalPrivate;
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000001' })).resolves.toBe(true);
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(20, 6);
        expect(ledger.layerValue(1)).toBeCloseTo(60, 6);
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000002' }))
            .rejects.toThrow(/ya tiene una reversa/);
    });

    it('finishes with a short balance like sales: records the deficit and reports the shortage', async () => {
        const { ledger, tx } = setup('FIFO', [plate({}, 40)]);
        const alert = jest.fn(async () => ({}));
        tx.auditLog = { create: alert };
        const catering = CateringService as unknown as CateringPrivate;
        const shortages = await catering.deductInventoryTx(tx, 5, 1, 9, 1);
        expect(alert).toHaveBeenCalledTimes(1);
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(-10, 6);
        expect(ledger.movements.filter((m) => m.reference === 'EVT-5' && m.type === 'OUT')).toHaveLength(1);
        expect(ledger.openSlices(1)).toHaveLength(1);
        expect(shortages).toEqual([expect.objectContaining({ productId: 1, warehouseId: 1, required: 10, available: 0, unit: 'kg' })]);
    });

    it('a services-only finished event has nothing to return (NOT_CONSUMED instead of an error)', async () => {
        const { tx } = setup('FIFO', [{ quantity: 10, menuItem: { recipes: [] } }]);
        const fiscal = CateringFiscalService as unknown as FiscalPrivate;
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000003' })).resolves.toBe(false);
    });

    it('decides from recorded EVT consumption, not from the dishes current recipes', async () => {
        // Recipes added after the event finished must not turn a no-consumption
        // event into an unreversible one.
        const { tx } = setup('FIFO', [plate({}, 2)]);
        const fiscal = CateringFiscalService as unknown as FiscalPrivate;
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000004' })).resolves.toBe(false);
    });
});

describe('catering inventory: per-ingredient warehouse routing (same as sales)', () => {
    beforeEach(() => {
        jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
        jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (
            _productId: number, _companyId: number, quantity: number
        ) => ({ baseQuantity: quantity, originalQuantity: null, originalUnit: null, conversionFactor: null })) as never);
    });

    // Branch 1: warehouse 1 (event warehouse / fallback) and 2 (bar). Product 2
    // (category 7) is routed to warehouse 2; warehouse 3 belongs to branch 2.
    const routes: Array<{ warehouseId: number; categoryId?: number | null; productId?: number | null; branchId: number }> = [];
    function setup(menuItems: unknown[]) {
        routes.length = 0;
        routes.push({ warehouseId: 2, categoryId: 7, branchId: 1 });
        const ledger = makeInventoryLedger({
            costingMethod: 'FIFO',
            avgCost: 3,
            routing: {
                warehouses: [
                    { id: 1, branchId: 1, type: 'BRANCH' },
                    { id: 2, branchId: 1, type: 'BRANCH' },
                    { id: 3, branchId: 2, type: 'BRANCH' },
                ],
                routes,
                productCategories: { 1: null, 2: 7 },
            },
        });
        const tx = ledger.tx as unknown as Record<string, unknown>;
        tx.cateringEvent = { findUnique: jest.fn(async () => ({ id: 5, branchId: 1, title: 'Boda', menuItems })) };
        return { ledger, tx };
    }

    const dish = (quantity: number) => ({
        quantity,
        menuItem: {
            recipes: [
                { productId: 1, quantity: 2, unit: 'kg', product: { name: 'Lomo', unit: 'kg', baseUnit: { abbreviation: 'kg' } } },
                { productId: 2, quantity: 1, unit: 'kg', product: { name: 'Hielo', unit: 'kg', baseUnit: { abbreviation: 'kg' } } },
            ],
        },
    });

    async function receive(tx: unknown, warehouseId: number, productId: number, quantity: number) {
        await InventoryEngineService.applyMovement(tx as never, {
            type: 'IN', companyId: 1, warehouseId, productId, userId: 9, quantity, unitCost: 3,
            reference: `PO-${warehouseId}-${productId}`, sourceType: 'PURCHASE',
        });
    }

    it('consumes each ingredient from its routed warehouse (event warehouse as fallback), locking ascending FOR SHARE', async () => {
        const { ledger, tx } = setup([dish(4)]);
        await receive(tx, 1, 1, 20);
        await receive(tx, 2, 2, 20);
        const lockSpy = jest.spyOn(InventoryEngineService, 'lockInventoryScope');

        const shortages = await (CateringService as unknown as CateringPrivate).deductInventoryTx(tx, 5, 1, 9, 1);

        expect(shortages).toEqual([]);
        expect(Number(ledger.stockOf(1, 1)!.quantity)).toBeCloseTo(12, 6);
        expect(Number(ledger.stockOf(2, 2)!.quantity)).toBeCloseTo(16, 6);
        expect(ledger.stockOf(1, 2)).toBeUndefined();
        const outs = ledger.movements.filter((m) => m.reference === 'EVT-5' && m.type === 'OUT');
        expect(outs.map((m) => [m.warehouseId, m.productId])).toEqual([[1, 1], [2, 2]]);
        // Scope lock: fallback + routed warehouses, ascending, default SHARE mode.
        const [, , warehouseIds, , mode] = lockSpy.mock.calls[0] as unknown[];
        expect([...(warehouseIds as Iterable<number>)]).toEqual([1, 2]);
        expect(mode ?? 'SHARE').toBe('SHARE');
    });

    it('credit-note return restores exactly the consumed warehouses even if routing changed afterwards', async () => {
        const { ledger, tx } = setup([dish(4)]);
        await receive(tx, 1, 1, 20);
        await receive(tx, 2, 2, 20);
        await (CateringService as unknown as CateringPrivate).deductInventoryTx(tx, 5, 1, 9, 1);

        // The bar rule is re-pointed to warehouse 1 after the event finished.
        routes.length = 0;
        routes.push({ warehouseId: 1, categoryId: 7, branchId: 1 });
        const lockSpy = jest.spyOn(InventoryEngineService, 'lockInventoryScope');

        const fiscal = CateringFiscalService as unknown as FiscalPrivate;
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000010' }))
            .resolves.toBe(true);

        expect(Number(ledger.stockOf(1, 1)!.quantity)).toBeCloseTo(20, 6);
        expect(Number(ledger.stockOf(2, 2)!.quantity)).toBeCloseTo(20, 6);
        expect(ledger.stockOf(1, 2)).toBeUndefined();
        const [, , warehouseIds, , mode] = lockSpy.mock.calls[0] as unknown[];
        expect([...new Set(warehouseIds as Iterable<number>)].sort((a, b) => a - b)).toEqual([1, 2]);
        expect(mode ?? 'SHARE').toBe('SHARE');
    });

    it('rejects a warehouse of another branch', async () => {
        const { ledger, tx } = setup([dish(1)]);
        await expect((CateringService as unknown as CateringPrivate).deductInventoryTx(tx, 5, 1, 9, 3))
            .rejects.toThrow(/No se encontró almacén/);
        expect(ledger.movements.filter((m) => m.reference === 'EVT-5')).toHaveLength(0);
    });

    it('short stock: finishes, records deficit slices + CateringEvent alert, and the return clears the deficit', async () => {
        const { ledger, tx } = setup([dish(4)]);
        await receive(tx, 1, 1, 20);
        await receive(tx, 2, 2, 1); // needs 4

        const shortages = await (CateringService as unknown as CateringPrivate).deductInventoryTx(tx, 5, 1, 9, 1);

        expect(Number(ledger.stockOf(2, 2)!.quantity)).toBeCloseTo(-3, 6);
        expect(ledger.openSlices(2, 2)).toHaveLength(1);
        expect(Number(ledger.openSlices(2, 2)[0].quantity)).toBeCloseTo(3, 6);
        expect(shortages).toEqual([expect.objectContaining({
            productId: 2, productName: 'Hielo', warehouseId: 2, warehouseName: 'Bodega #2', required: 4, available: 1, unit: 'kg',
        })]);
        const alert = ledger.auditLogs.find((row) => row.action === NEGATIVE_SALE_STOCK_ACTION);
        expect(alert).toEqual(expect.objectContaining({ entityType: 'CateringEvent', entityId: 5 }));
        expect(describeCateringShortages(shortages)).toMatch(/Hielo en Bodega #2: requerido 4 kg, disponible 1 kg/);

        const fiscal = CateringFiscalService as unknown as FiscalPrivate;
        await expect(fiscal.reverseFinishedInventory(tx, { eventId: 5, companyId: 1, userId: 9, creditNoteNumber: 'NC-000011' }))
            .resolves.toBe(true);
        expect(Number(ledger.stockOf(2, 2)!.quantity)).toBeCloseTo(1, 6);
        expect(ledger.openSlices(2, 2)).toHaveLength(0);
        expect(Number(ledger.stockOf(1, 1)!.quantity)).toBeCloseTo(20, 6);
    });

    it('preview shows the routed source warehouse, required and available per ingredient', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue({ id: 5, branchId: 1, menuItems: [dish(4)] } as never);
        jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: 1 } as never);
        jest.spyOn(prisma.warehouse, 'findMany').mockResolvedValue([{ id: 1, name: 'Cocina' }, { id: 2, name: 'Bar' }] as never);
        jest.spyOn(prisma.stock, 'findMany').mockResolvedValue([
            { warehouseId: 1, productId: 1, quantity: 20 },
            { warehouseId: 1, productId: 2, quantity: 50 }, // not the routed warehouse: ignored
            { warehouseId: 2, productId: 2, quantity: 1 },
        ] as never);
        const route = jest.spyOn(WarehouseRouteService, 'resolveForBranch').mockResolvedValue(new Map([[1, 1], [2, 2]]));

        const preview = await CateringService.getInventoryPreview(5, 1, 1);

        expect(route).toHaveBeenCalledWith(expect.anything(), 1, 1, 1, [1, 2]);
        expect(preview.lines).toEqual([
            expect.objectContaining({ productId: 2, warehouseName: 'Bar', routed: true, required: 4, available: 1, shortage: 3 }),
            expect.objectContaining({ productId: 1, warehouseName: 'Cocina', routed: false, required: 8, available: 20, shortage: 0 }),
        ]);
    });

    it('describeCateringShortages is null when nothing was short', () => {
        expect(describeCateringShortages([])).toBeNull();
        expect(describeCateringShortages(undefined)).toBeNull();
    });
});
