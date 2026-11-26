import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { CostingService } from '../../services/costing.service';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { AuditLogService } from '../../services/audit-log.service';
import { makeInventoryLedger } from './support/fake-inventory-ledger';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];
const base = { companyId: 1, productId: 1, userId: 9 };

beforeEach(() => {
    jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'reverseInventoryMovementCost').mockResolvedValue(undefined as never);
});
afterEach(() => {
    jest.restoreAllMocks();
});

/** Full ledger invariant: sum of movement values = layers - open deficit cost. */
function expectLedgerInvariant(ledger: ReturnType<typeof makeInventoryLedger>, warehouseId = 1) {
    expect(ledger.ledgerSum(warehouseId)).toBeCloseTo(ledger.layerValue(warehouseId) - ledger.openDeficitCost(warehouseId), 6);
}

describe('#1 receipt reversal whose covered shortfall is now backed by a later layer (FIFO, p=2)', () => {
    it('values the shortfall from the consumed layer and trues the sold units up to its cost', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        // Sell 20 from 0 -> -20 (provisional 40).
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, allowNegative: true, reference: 'ORD-1' });
        // PO1 100 @3 -> layer 80, true-up +20.
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 100, unitCost: 3, reference: 'PO-1-R1', sourceType: 'PURCHASE' });
        // PO2 50 @4.
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 50, unitCost: 4, reference: 'PO-2-R1', sourceType: 'PURCHASE' });
        expect(ledger.trueUpCogs()).toBeCloseTo(20, 6);

        // Reverse PO1: exact layer leg (80) + covered shortfall (20).
        await InventoryEngineService.applyMovement(tx, {
            ...base, warehouseId: 1, type: 'OUT', quantity: 80, reference: 'PO-1-R1',
            consumeSourceRef: 'PO-1-R1', valueFromConsumedLayers: true
        });
        const shortfall = await InventoryEngineService.reverseCoveredShortfall(tx, {
            ...base, warehouseId: 1, type: 'OUT', quantity: 20, unitCost: 3, reference: 'PO-1-R1'
        });

        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(30, 6);
        expect(ledger.layerValue(1)).toBeCloseTo(120, 6);
        // The covered leg leaves 140 (layer value removed at the receipt cost);
        // its true-up row restates the running balance to the layer value.
        const last = ledger.movements[ledger.movements.length - 1];
        expect(last.origin).toBe('COST_TRUE_UP');
        expect(Number(last.balanceCost)).toBeCloseTo(120, 6);
        // The return takes out exactly what PO1 brought in (240 + 60 = 300);
        // the extra layer value of PO2 (20) goes to COGS via the true-up.
        expect(shortfall.totalCost).toBeCloseTo(60, 6);
        expect(shortfall.trueUpAmount).toBeCloseTo(20, 6);
        const po1Return = ledger.movements
            .filter((m) => m.reference === 'PO-1-R1' && m.type === 'OUT')
            .reduce((sum, m) => sum + Number(m.totalCost), 0);
        expect(po1Return).toBeCloseTo(300, 6);
        expectLedgerInvariant(ledger);
        // The 20 sold units now cost 4 each: 40 provisional + 20 + 20 = 80.
        expect(40 + ledger.trueUpCogs()).toBeCloseTo(80, 6);
        expect(Number(ledger.stockOf(1)!.negativeBalanceCost)).toBe(0);
        // PO2 stays exactly reversible: its own layer still holds 30 units.
        expect(ledger.layersOf(1).every((b) => b.sourceRef === 'PO-2-R1')).toBe(true);
    });

    it('re-creates only the uncovered part of the deficit at the receipt cost', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, allowNegative: true });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 100, unitCost: 3, reference: 'PO-1-R1' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 10, unitCost: 4, reference: 'PO-2-R1' });
        await InventoryEngineService.applyMovement(tx, {
            ...base, warehouseId: 1, type: 'OUT', quantity: 80, consumeSourceRef: 'PO-1-R1', valueFromConsumedLayers: true
        });

        await InventoryEngineService.reverseCoveredShortfall(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, unitCost: 3 });

        // 10 covered by PO2 (40, true-up +10), 10 back below zero at 3.
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(-10, 6);
        expect(Number(ledger.stockOf(1)!.negativeBalanceCost)).toBeCloseTo(30, 6);
        expect(ledger.layersOf(1)).toHaveLength(0);
        expect(ledger.trueUpCogs()).toBeCloseTo(20 + 10, 6);
        expectLedgerInvariant(ledger);
    });
});

describe('#2 return of a sale whose negative balance was covered meanwhile (FIFO, p=2)', () => {
    async function soldThenCovered() {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 10, allowNegative: true, reference: 'ORD-7' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 100, unitCost: 3, reference: 'PO-1-R1' });
        return { ledger, tx };
    }

    it('full credit note restores the 10 units at 3 and reverses the true-up COGS', async () => {
        const { ledger, tx } = await soldThenCovered();
        expect(ledger.trueUpCogs()).toBeCloseTo(10, 6);

        await InventoryConsumptionService.reverseForOrder(tx, {
            orderId: 7, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-1'
        });

        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(100, 6);
        expect(ledger.layerValue(1)).toBeCloseTo(300, 6);
        // ORD ledger nets to zero (OUT 20 / IN 20) and the true-up is reversed.
        // Order COGS readers only take ORD OUT/IN rows (the true-up is an ADJUSTMENT).
        const ord = ledger.movements.filter((m) => m.reference === 'ORD-7' && (m.type === 'OUT' || m.type === 'IN'));
        const ordNet = ord.reduce((sum, m) => sum + (m.type === 'OUT' ? 1 : -1) * Number(m.totalCost), 0);
        expect(ordNet).toBeCloseTo(0, 6);
        expect(ledger.trueUpCogs()).toBeCloseTo(0, 6);
        const last = ledger.movements[ledger.movements.length - 1];
        expect(Number(last.balanceCost)).toBeCloseTo(300, 6);
        expectLedgerInvariant(ledger);
    });

    it('partial credit note restores its share at the trued-up cost', async () => {
        const { ledger, tx } = await soldThenCovered();

        await InventoryConsumptionService.reverseQuantitiesForOrder(tx, {
            orderId: 7, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-2',
            quantities: [{ productId: 1, quantity: 4 }]
        });

        expect(ledger.layerValue(1)).toBeCloseTo(90 * 3 + 4 * 3, 6);
        expect(ledger.trueUpCogs()).toBeCloseTo(10 - 4, 6);
        expectLedgerInvariant(ledger);
    });

    it('while a deficit is still open: covered units come back at their real cost, open ones leave the queue', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 10, allowNegative: true, reference: 'ORD-8' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 4, unitCost: 3, reference: 'PO-1-R1' });

        await InventoryConsumptionService.reverseForOrder(tx, {
            orderId: 8, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-3'
        });

        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(4, 6);
        // The 4 units covered at 3 are back at 3; the 6 still open left the queue.
        expect(ledger.layerValue(1)).toBeCloseTo(12, 6);
        expect(ledger.openSlices(1)).toHaveLength(0);
        expect(Number(ledger.stockOf(1)!.negativeBalanceCost)).toBeCloseTo(0, 6);
        expectLedgerInvariant(ledger);
    });
});

describe('#6 reversing inbounds that covered a negative balance', () => {
    function useLedgerTransaction(tx: unknown) {
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: unknown) => unknown) => callback(tx)) as never
        );
    }

    it('reverses a physical-count IN (stock -20, count 5 -> IN 25, layer 5)', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, allowNegative: true });
        const count = await InventoryEngineService.applyMovement(tx, {
            ...base, warehouseId: 1, type: 'ADJUSTMENT', direction: 'IN', quantity: 25, unitCost: 3, origin: 'MANUAL'
        });
        expect(ledger.layersOf(1).map((b) => Number(b.remainingQty))).toEqual([5]);
        useLedgerTransaction(ledger.tx);

        const result = await InventoryMovementService.reverse(1, count.movementId, {
            userId: 9, reason: 'Conteo erróneo', reversalKey: 'rev-count-1'
        });

        expect(result.success).toBe(true);
        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(-20, 6);
        expect(Number(ledger.stockOf(1)!.negativeBalanceCost)).toBeCloseTo(60, 6);
        expect(ledger.layersOf(1)).toHaveLength(0);
        expect(ledger.movements.filter((m) => m.reversalOfId === count.movementId)).toHaveLength(1);
        expectLedgerInvariant(ledger);
    });

    it('reverses a transfer whose inbound leg covered a negative destination (legacy true-up in the group)', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 30, unitCost: 3, reference: 'PO-1-R1' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 2, type: 'OUT', quantity: 20, allowNegative: true });
        const out = await InventoryEngineService.applyMovement(tx, {
            ...base, warehouseId: 1, type: 'TRANSFER', direction: 'OUT', quantity: 25, transferGroupId: 'TRF-1', origin: 'TRANSFER'
        });
        const inbound = await InventoryEngineService.applyMovement(tx, {
            ...base, warehouseId: 2, type: 'TRANSFER', direction: 'IN', quantity: 25, unitCost: out.unitCost,
            inboundLayers: out.consumedLayers, transferGroupId: 'TRF-1', sourceType: 'TRANSFER', origin: 'TRANSFER'
        });
        // New true-up rows never join the transfer group...
        const trueUp = ledger.movements.find((m) => m.id === inbound.costTrueUp!.movementId)!;
        expect(trueUp.transferGroupId).toBeNull();
        // ...but legacy rows did; the reversal must ignore them.
        trueUp.transferGroupId = 'TRF-1';
        useLedgerTransaction(ledger.tx);

        await InventoryMovementService.reverse(1, out.movementId, {
            userId: 9, reason: 'Traslado erróneo', reversalKey: 'rev-trf-1'
        });

        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(30, 6);
        expect(ledger.layerValue(1)).toBeCloseTo(90, 6);
        expect(Number(ledger.stockOf(2)!.quantity)).toBeCloseTo(-20, 6);
        expect(Number(ledger.stockOf(2)!.negativeBalanceCost)).toBeCloseTo(60, 6);
        expectLedgerInvariant(ledger, 1);
        expectLedgerInvariant(ledger, 2);
        // Destination OUT legs take out exactly what the source IN restores.
        const reversalRows = ledger.movements.filter((m) => m.origin === 'REVERSAL');
        const destinationOut = reversalRows.filter((m) => m.warehouseId === 2).reduce((sum, m) => sum + Number(m.totalCost), 0);
        const sourceIn = reversalRows.filter((m) => m.warehouseId === 1).reduce((sum, m) => sum + Number(m.totalCost), 0);
        expect(destinationOut).toBeCloseTo(sourceIn, 6);
    });
});

describe('#7 FIFO kardex balance includes the open deficit', () => {
    it('shows -10p at -10 and -6p after an IN of 4 (p=2, inbound 3)', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        const sale = await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 10, allowNegative: true });
        expect(sale.balanceCost).toBeCloseTo(-20, 6);
        const more = await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 5, allowNegative: true });
        expect(more.balanceCost).toBeCloseTo(-30, 6);
        const inbound = await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 4, unitCost: 3 });
        // -15 + 4 = -11 units still at the provisional 2.
        expect(inbound.balanceCost).toBeCloseTo(-22, 6);
    });
});

describe('D2 multi-receipt PO reversal runs every exact layer leg before any shortfall', () => {
    it('R1 covered a deficit, R2 did not: both reverse and the deficit is re-created at the receipt cost', async () => {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, allowNegative: true });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 30, unitCost: 3, reference: 'PO-1-R1', sourceType: 'PURCHASE' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'IN', quantity: 30, unitCost: 3, reference: 'PO-1-R2', sourceType: 'PURCHASE' });
        const poTx = Object.assign(ledger.tx, {
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 1, status: 'RECEIVED', items: [{ id: 31 }] })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 1, ...args.data }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
            purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 2 })) }
        });
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: unknown) => unknown) => callback(poTx)) as never
        );
        jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');

        expect(Number(ledger.stockOf(1)!.quantity)).toBeCloseTo(-20, 6);
        expect(Number(ledger.stockOf(1)!.negativeBalanceCost)).toBeCloseTo(60, 6);
        expect(ledger.layersOf(1)).toHaveLength(0);
        const returned = ledger.movements
            .filter((m) => String(m.reference).startsWith('PO-1-R') && m.type === 'OUT')
            .reduce((sum, m) => sum + Number(m.totalCost), 0);
        expect(returned).toBeCloseTo(180, 6);
        // Reversal legs are marked as such for the kardex.
        expect(ledger.movements.filter((m) => m.type === 'OUT' && String(m.reference).startsWith('PO-1-R'))
            .every((m) => m.origin === 'REVERSAL')).toBe(true);
        expectLedgerInvariant(ledger);
    });
});

describe('D3 a return uses the true-ups of its own deficit episode', () => {
    async function returnFirstSale(steps: Array<{ type: 'OUT' | 'IN'; quantity: number; unitCost?: number; reference?: string }>) {
        const ledger = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = ledger.tx as unknown as Tx;
        for (const step of steps) {
            await InventoryEngineService.applyMovement(tx, {
                ...base, warehouseId: 1, type: step.type, quantity: step.quantity,
                ...(step.type === 'OUT' ? { allowNegative: true } : { unitCost: step.unitCost }),
                reference: step.reference
            });
        }
        const trueUpBefore = ledger.trueUpCogs();
        await InventoryConsumptionService.reverseForOrder(tx, {
            orderId: 1, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-1'
        });
        const restore = ledger.movements.filter((m) => m.reference === 'ORD-1' && m.type === 'IN')[0];
        const restoreTrueUp = ledger.movements.filter((m) => m.reference === 'ORD-1' && m.origin === 'COST_TRUE_UP')[0];
        const restoredValue = Number(restore.totalCost) + (restoreTrueUp
            ? (restoreTrueUp.direction === 'IN' ? 1 : -1) * Number(restoreTrueUp.totalCost)
            : 0);
        return { ledger, trueUpBefore, restoredValue };
    }

    it('two episodes: S1 (covered at 3) comes back at 3, not at the later episode cost 5', async () => {
        const { ledger, trueUpBefore, restoredValue } = await returnFirstSale([
            { type: 'OUT', quantity: 10, reference: 'ORD-1' },
            { type: 'IN', quantity: 10, unitCost: 3, reference: 'PO-1-R1' },
            { type: 'OUT', quantity: 10, reference: 'ORD-2' },
            { type: 'IN', quantity: 10, unitCost: 5, reference: 'PO-2-R1' }
        ]);
        expect(trueUpBefore).toBeCloseTo(10 + 30, 6);
        expect(restoredValue).toBeCloseTo(30, 6);
        expect(ledger.trueUpCogs()).toBeCloseTo(30, 6);
        expectLedgerInvariant(ledger);
    });

    it('blends a partial coverage (4 @3 + 6 @5 -> 4.2)', async () => {
        const { ledger, restoredValue } = await returnFirstSale([
            { type: 'OUT', quantity: 10, reference: 'ORD-1' },
            { type: 'IN', quantity: 4, unitCost: 3, reference: 'PO-1-R1' },
            { type: 'IN', quantity: 6, unitCost: 5, reference: 'PO-2-R1' }
        ]);
        expect(restoredValue).toBeCloseTo(42, 6);
        expect(ledger.trueUpCogs()).toBeCloseTo(0, 6);
        expectLedgerInvariant(ledger);
    });

    it('counts coverage at the provisional cost (no true-up row) in the blend', async () => {
        const { ledger, restoredValue } = await returnFirstSale([
            { type: 'OUT', quantity: 10, reference: 'ORD-1' },
            { type: 'IN', quantity: 4, unitCost: 3, reference: 'PO-1-R1' },
            { type: 'IN', quantity: 6, unitCost: 2, reference: 'PO-2-R1' }
        ]);
        // (4 x 3 + 6 x 2) / 10 = 2.4 per unit.
        expect(restoredValue).toBeCloseTo(24, 6);
        expect(ledger.trueUpCogs()).toBeCloseTo(0, 6);
        expectLedgerInvariant(ledger);
    });
});
