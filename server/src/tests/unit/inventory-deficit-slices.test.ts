/**
 * Deficit-slice ledger probes (refuter round 2): every case asserts the full
 * ledger invariant (sum of movement values = layer value - open deficit cost)
 * and the COGS of the units sold on a negative balance.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
type L = ReturnType<typeof makeInventoryLedger>;
const poTxFor = (l: L) => {
    const t = Object.assign(l.tx, {
        purchaseOrder: { findFirst: jest.fn(async () => ({ id: 1, status: 'RECEIVED', items: [{ id: 31 }] })), update: jest.fn(async (a: any) => ({ id: 1, ...a.data })) },
        user: { findFirst: jest.fn(async () => ({ id: 9 })) },
        purchaseOrderPayment: { count: jest.fn(async () => 0) },
        purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
        purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 2 })) }
    });
    jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(t)) as never);
    jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
    jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
};
const base = { companyId: 1, productId: 1, userId: 9 };

beforeEach(() => {
    jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'reverseInventoryMovementCost').mockResolvedValue(undefined as never);
});
afterEach(() => {
    jest.restoreAllMocks();
});

const inv = (l: L, w = 1) => ({ ledger: l.ledgerSum(w), expected: l.layerValue(w) - l.openDeficitCost(w), qty: Number(l.stockOf(w)?.quantity), deficitCost: l.openDeficitCost(w), layers: l.layerValue(w) });
const sale = (tx: Tx, q: number, ref?: string, w = 1) => InventoryEngineService.applyMovement(tx, { ...base, warehouseId: w, type: 'OUT', quantity: q, allowNegative: true, reference: ref });
const buy = (tx: Tx, q: number, c: number, ref?: string, w = 1) => InventoryEngineService.applyMovement(tx, { ...base, warehouseId: w, type: 'IN', quantity: q, unitCost: c, reference: ref, sourceType: 'PURCHASE' });
const setAvg = (l: L, avg: number) => {
    (l.tx.product as any).findFirst = jest.fn(async () => ({ id: 1, name: 'P', currentAverageCost: avg, averageCostKnown: true, cost: avg, referenceCostKnown: true }));
};
/** COGS = provisional sale OUT values (ORD refs) - ORD IN restores + true-ups */
const cogs = (l: L) => l.movements.reduce((s, m: any) => {
    if (m.origin === 'COST_TRUE_UP') return s + (m.direction === 'OUT' ? 1 : -1) * Number(m.totalCost);
    if (String(m.reference ?? '').startsWith('ORD-')) return s + (m.type === 'OUT' ? 1 : -1) * Number(m.totalCost);
    return s;
}, 0);

describe('ITEM1 reverseCoveredShortfall', () => {
    async function setup(later: Array<[number, number]>, poCost = 5) {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        await buy(tx, 100, poCost, 'PO-1-R1');
        for (const [q, c] of later) await buy(tx, q, c, 'PO-X');
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 80, consumeSourceRef: 'PO-1-R1', valueFromConsumedLayers: true, reference: 'PO-1-R1' });
        const r = await InventoryEngineService.reverseCoveredShortfall(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 20, unitCost: poCost, reference: 'PO-1-R1' });
        return { l, r };
    }
    it('C<u (later layer 3, receipt 5)', async () => {
        const { l, r } = await setup([[50, 3]]);
        const i = inv(l);
        // Layer cost 3 below the receipt cost 5: the true-up lowers COGS.
        expect(r.trueUpAmount).toBeCloseTo(-40, 6);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(60, 6);
    });
    it('multiple layers 10@3 + 10@6', async () => {
        const { l } = await setup([[10, 3], [10, 6]]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(90, 6);
    });
    it('partial: 5@3 covers, 15 re-deficit at 5', async () => {
        const { l } = await setup([[5, 3]]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(i.deficitCost).toBeCloseTo(75, 6);
        // then cover with 15@7: units real 5@3 + 15@7 = 120
        await buy(l.tx as unknown as Tx, 15, 7, 'PO-9');
        expect(cogs(l)).toBeCloseTo(120, 6);
        const j = inv(l); expect(j.ledger).toBeCloseTo(j.expected, 6);
    });
    it('transfer reversal, multi-cost inbound layers trimmed from tail', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await buy(tx, 10, 3, 'PO-A');
        await buy(tx, 15, 5, 'PO-B');
        await sale(tx, 20, 'ORD-1', 2);
        const out = await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'TRANSFER', direction: 'OUT', quantity: 25, transferGroupId: 'TRF-1', origin: 'TRANSFER' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 2, type: 'TRANSFER', direction: 'IN', quantity: 25, unitCost: out.unitCost, inboundLayers: out.consumedLayers, transferGroupId: 'TRF-1', sourceType: 'TRANSFER', origin: 'TRANSFER' });
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(l.tx)) as never);
        await InventoryMovementService.reverse(1, out.movementId, { userId: 9, reason: 'Traslado erróneo', reversalKey: 'rev-trf-xx' });
        const i2 = inv(l, 2); const i1 = inv(l, 1);
        expect(i1.ledger).toBeCloseTo(i1.expected, 6);
        expect(i2.ledger).toBeCloseTo(i2.expected, 6);
    });
});

describe('ITEM2 reverseReceipt', () => {
    function poTx(l: L) {
        const t = Object.assign(l.tx, {
            purchaseOrder: { findFirst: jest.fn(async () => ({ id: 1, status: 'RECEIVED', items: [{ id: 31 }] })), update: jest.fn(async (a: any) => ({ id: 1, ...a.data })) },
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
            purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 2 })) }
        });
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(t)) as never);
        jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
    }
    it('3 receipts with deficits at different points', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        await buy(tx, 10, 3, 'PO-1-R1');
        await buy(tx, 10, 4, 'PO-1-R2');
        await sale(tx, 5, 'ORD-2');
        await buy(tx, 15, 5, 'PO-1-R3');
        await buy(tx, 7, 9, 'PO-2-R1');
        poTx(l);
        await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        const returned = l.movements.filter((m: any) => String(m.reference).startsWith('PO-1-R') && m.type === 'OUT').reduce((s, m: any) => s + Number(m.totalCost), 0);
        expect(returned).toBeCloseTo(30 + 40 + 75, 6);
        // 7 units of PO-2 at 9 cover the deficit; 25 sold units: 7@9 + 18 provisional at receipt cost
        expect(cogs(l) - (i.deficitCost)).toBeCloseTo(63, 6);
    });
    it('two warehouses', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 10, 'ORD-1', 1);
        await sale(tx, 4, 'ORD-2', 2);
        await buy(tx, 30, 3, 'PO-1-R1', 1);
        await buy(tx, 20, 3, 'PO-1-R1', 2);
        await buy(tx, 5, 6, 'PO-2-R1', 2);
        poTx(l);
        await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');
        const a = inv(l, 1), b = inv(l, 2);
        expect(a.ledger).toBeCloseTo(a.expected, 6);
        expect(b.ledger).toBeCloseTo(b.expected, 6);
        expect(a.deficitCost).toBeCloseTo(30, 6);
        expect(b.qty).toBeCloseTo(1, 6);
    });
    it('receipt layer partially consumed refuses', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        await buy(tx, 100, 3, 'PO-1-R1');
        await sale(tx, 10, 'ORD-2');
        poTx(l);
        await expect(PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada')).rejects.toThrow(/ya fue consumido/);
    });
});

describe('ITEM3 revalueCoveredDeficitLayers', () => {
    async function run(l: L, orders: number[]) {
        const tx = l.tx as unknown as Tx;
        for (const o of orders) {
            await InventoryConsumptionService.reverseForOrder(tx, { orderId: o, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: `NC-${o}` });
        }
    }
    it('A: sale in middle of open deficit, different provisional rates', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 5, 'ORD-1');
        setAvg(l, 4);
        await sale(tx, 10, 'ORD-2');
        await buy(tx, 15, 3, 'PO-1-R1');
        await run(l, [2]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(15, 6); // remaining 5 sold units at real 3
    });
    it('B: two sales, inbound between, returned separately', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 10, 'ORD-1');
        await buy(tx, 4, 3, 'PO-1-R1');
        await sale(tx, 10, 'ORD-2');
        await buy(tx, 16, 5, 'PO-2-R1');
        await run(l, [1, 2]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(0, 6);
        expect(l.layerValue(1)).toBeCloseTo(92, 6);
    });
    it('B2: two sales same episode, no inbound between', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 10, 'ORD-1');
        await sale(tx, 10, 'ORD-2');
        await buy(tx, 4, 3, 'PO-1-R1');
        await buy(tx, 16, 5, 'PO-2-R1');
        await run(l, [2, 1]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(0, 6);
    });
    it('C: covering inbound later reversed (reverso true-up)', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        const po1 = await buy(tx, 100, 3, 'PO-1-R1');
        await buy(tx, 50, 4, 'PO-2-R1');
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'OUT', quantity: 80, consumeSourceRef: 'PO-1-R1', valueFromConsumedLayers: true, reference: 'PO-1-R1' });
        // The reversed inbound is named so its covered slices move to the new cover.
        await InventoryEngineService.reverseCoveredShortfall(tx, {
            ...base, warehouseId: 1, type: 'OUT', quantity: 20, unitCost: 3, reference: 'PO-1-R1', coveringMovementIds: [po1.movementId]
        });
        await run(l, [1]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(0, 6);
    });
    it('D: physical count / transfer-in as covering inbound', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 10, 'ORD-1');
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'ADJUSTMENT', direction: 'IN', quantity: 4, unitCost: 3, origin: 'MANUAL' });
        await buy(tx, 10, 5, 'PO-T', 2);
        const out = await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 2, type: 'TRANSFER', direction: 'OUT', quantity: 10, transferGroupId: 'T', origin: 'TRANSFER' });
        await InventoryEngineService.applyMovement(tx, { ...base, warehouseId: 1, type: 'TRANSFER', direction: 'IN', quantity: 10, unitCost: out.unitCost, inboundLayers: out.consumedLayers, transferGroupId: 'T', sourceType: 'TRANSFER', origin: 'TRANSFER' });
        await run(l, [1]);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(0, 6);
    });
});

describe('slice ledger through the purchase-order reversal path', () => {
    it('C via reverseReceipt: the sale returns at the cost of the layer that now covers it', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        await buy(tx, 100, 3, 'PO-1-R1');
        await buy(tx, 50, 4, 'PO-2-R1');
        poTxFor(l);
        await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');
        await InventoryConsumptionService.reverseForOrder(tx, { orderId: 1, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-1' });
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
        expect(cogs(l)).toBeCloseTo(0, 6);
        expect(l.layerValue(1)).toBeCloseTo(50 * 4, 6);
    });

    it('keeps Stock.negativeBalanceCost equal to the open slices', async () => {
        const l = makeInventoryLedger({ costingMethod: 'FIFO', avgCost: 2 });
        const tx = l.tx as unknown as Tx;
        await sale(tx, 20, 'ORD-1');
        await buy(tx, 10, 3, 'PO-1-R1');
        await buy(tx, 10, 4, 'PO-1-R2');
        await sale(tx, 5, 'ORD-2');
        await buy(tx, 3, 5, 'PO-1-R3');
        expect(l.openDeficitCost(1)).toBeCloseTo(l.openSliceValue(1), 6);
        poTxFor(l);
        await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');
        expect(l.openDeficitCost(1)).toBeCloseTo(l.openSliceValue(1), 6);
        const i = inv(l);
        expect(i.ledger).toBeCloseTo(i.expected, 6);
    });
});

describe('round-3 slice probes (both costing methods)', () => {
    const partialNote = (tx: Tx, orderId: number, quantity: number, key: string) =>
        InventoryConsumptionService.reverseQuantitiesForOrder(tx, {
            orderId, userId: 9, companyId: 1, reason: 'NC parcial', sourceType: 'ADJUSTMENT', reversalOrigin: key,
            quantities: [{ productId: 1, quantity }]
        });
    const fullNote = (tx: Tx, orderId: number, key: string) =>
        InventoryConsumptionService.reverseForOrder(tx, {
            orderId, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: key
        });

    for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
        it(`${method}: refuses to reverse the covering receipt when returned units were sold again`, async () => {
            const l = makeInventoryLedger({ costingMethod: method, avgCost: 2 });
            const tx = l.tx as unknown as Tx;
            await sale(tx, 10, 'ORD-1');
            await buy(tx, 10, 3, 'PO-1-R1');
            await partialNote(tx, 1, 4, 'NC-a');
            setAvg(l, 3);
            await sale(tx, 2, 'ORD-2');
            poTxFor(l);
            const before = l.movements.length;
            await expect(PurchaseOrderService.reverseReceipt(1, 1, 9, 'x')).rejects.toThrow(/ya fueron consumidas/);
            expect(l.movements.length).toBe(before);
        });
    }

    for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
        for (const order of ['return-then-later-PO', 'later-PO-then-return'] as const) {
            it(`${method} ${order}: reversing the covering receipt after a partial note`, async () => {
                const l = makeInventoryLedger({ costingMethod: method, avgCost: 2 });
                const tx = l.tx as unknown as Tx;
                await sale(tx, 10, 'ORD-1');
                await buy(tx, 10, 3, 'PO-1-R1');
                if (order === 'return-then-later-PO') {
                    await partialNote(tx, 1, 4, 'NC-a');
                    await buy(tx, 10, 6, 'PO-2-R1');
                } else {
                    await buy(tx, 10, 6, 'PO-2-R1');
                    await partialNote(tx, 1, 4, 'NC-a');
                }
                poTxFor(l);
                await PurchaseOrderService.reverseReceipt(1, 1, 9, 'Recepción duplicada');
                // The 4 returned units leave from the return's own layer (no
                // true-up); the 6 still sold are now covered by PO-2 at 6.
                expect(cogs(l)).toBeCloseTo(36, 6);
                await fullNote(tx, 1, 'NC-z');
                const i = inv(l);
                expect(i.ledger).toBeCloseTo(i.expected, 6);
                expect(cogs(l)).toBeCloseTo(0, 6);
                expect(l.layerValue(1)).toBeCloseTo(60, 6);
            });
        }

        it(`${method} negative manual OUT reversal re-prices from its own slices`, async () => {
            const l = makeInventoryLedger({ costingMethod: method, avgCost: 2 });
            const tx = l.tx as unknown as Tx;
            await sale(tx, 10, 'ORD-1');
            setAvg(l, 5);
            const manual = await InventoryEngineService.applyMovement(tx, {
                ...base, warehouseId: 1, type: 'ADJUSTMENT', direction: 'OUT', quantity: 10, allowNegative: true, origin: 'MANUAL'
            });
            jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(l.tx)) as never);

            await InventoryMovementService.reverse(1, manual.movementId, { userId: 9, reason: 'Ajuste erróneo', reversalKey: `rev-man-${method}` });

            // Its own slice (10 @5) left the queue; the sale's slice (10 @2) stays.
            expect(Number(l.stockOf(1)!.quantity)).toBeCloseTo(-10, 6);
            expect(l.openDeficitCost(1)).toBeCloseTo(20, 6);
            expect(cogs(l)).toBeCloseTo(20, 6);
            await buy(tx, 10, 3, 'PO-1');
            expect(cogs(l)).toBeCloseTo(30, 6);
            await InventoryConsumptionService.reverseForOrder(tx, {
                orderId: 1, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'NC-1'
            });
            const i = inv(l);
            expect(i.ledger).toBeCloseTo(i.expected, 6);
            expect(cogs(l)).toBeCloseTo(0, 6);
            expect(l.layerValue(1)).toBeCloseTo(30, 6);
        });
    }
});

