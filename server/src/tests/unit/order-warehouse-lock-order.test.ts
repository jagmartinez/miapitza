import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OrderService } from '../../services/order.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';

beforeEach(() => {
    jest.spyOn(OrderService, 'readOrderTableIdOutsideTransaction').mockResolvedValue(null);
});

afterEach(() => {
    jest.restoreAllMocks();
});

type Row = Record<string, unknown>;

/**
 * Lock-order contract: delivery and prepared-order cancellation must not take a
 * standalone `Warehouse ... FOR UPDATE` before consumeForOrder. The first
 * warehouse lock of the flow is consumeForOrder's ascending
 * {fallback ∪ routed} lockInventoryScope; a sale/waste warehouse locked first
 * deadlocks against transfers/costing when a routed warehouse has a lower id.
 */
function recordingTx(order: Row) {
    const sql: string[] = [];
    const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
            sql.push(strings.join('?'));
            return [];
        }),
        order: {
            findFirst: jest.fn(async () => order),
            update: jest.fn(async (args: { data: Row }) => ({ ...order, ...args.data }))
        },
        orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
        user: { findFirst: jest.fn(async () => ({ id: 8 })) },
        warehouse: { findFirst: jest.fn(async () => ({ id: 2 })) },
        auditLog: { create: jest.fn(async () => ({})) }
    };
    return { tx, sql };
}

const sentItem = {
    id: 10,
    quantity: 1,
    subtotal: 10,
    sentAt: new Date('2026-11-18T12:00:00Z'),
    menuItem: { recipes: [] }
};

function spyConsume(sql: string[]) {
    const seenAtConsume: string[][] = [];
    const consume = jest.spyOn(InventoryConsumptionService, 'consumeForOrder')
        .mockImplementation((async () => {
            seenAtConsume.push([...sql]);
            return { consumed: true, negativeProductIds: [] };
        }) as never);
    return { consume, seenAtConsume };
}

const warehouseLocks = (statements: string[]) => statements.filter((statement) => /`Warehouse`/.test(statement));

describe('OrderService warehouse lock order', () => {
    it('delivery validates the sale warehouse with a plain read and leaves the first warehouse lock to consumeForOrder', async () => {
        const { tx, sql } = recordingTx({
            id: 41, branchId: 3, userId: 5, status: 'READY', financialStatus: 'PAID',
            total: 11.5, discountCode: null, tableId: null, items: [sentItem]
        });
        const { consume, seenAtConsume } = spyConsume(sql);

        await OrderService.completeWithTransaction(tx as never, 41, 1, 2, 8);

        expect(consume).toHaveBeenCalledTimes(1);
        expect(warehouseLocks(seenAtConsume[0])).toEqual([]);
        expect(warehouseLocks(sql)).toEqual([]);
        expect(tx.warehouse.findFirst as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 2, companyId: 1, branchId: 3, type: 'BRANCH' }
        }));
        const params = consume.mock.calls[0][1];
        // Sale delivery keeps ingredient routing and re-validates the branch under the lock.
        expect(params.route).toBeUndefined();
        expect(params.expectedBranchId).toBe(3);
    });

    it('delivering the order stamps still-undelivered lines with the acting user (M6)', async () => {
        const { tx, sql } = recordingTx({
            id: 41, branchId: 3, userId: 5, status: 'READY', financialStatus: 'PAID',
            total: 11.5, discountCode: null, tableId: null, items: [sentItem]
        });
        spyConsume(sql);

        const updated = await OrderService.completeWithTransaction(tx as never, 41, 1, 2, 8);

        expect(tx.orderItem.updateMany).toHaveBeenCalledTimes(1);
        const args = tx.orderItem.updateMany.mock.calls[0][0] as {
            where: Record<string, unknown>; data: { deliveredAt: Date; deliveredById: number };
        };
        expect(args.where).toEqual({ orderId: 41, deliveredAt: null, quantity: { gt: 0 } });
        expect(args.data.deliveredById).toBe(8);
        expect(args.data.deliveredAt).toBeInstanceOf(Date);
        expect((updated as unknown as { deliveredAt: Date }).deliveredAt).toBe(args.data.deliveredAt);
    });

    const preparedOrder = {
        id: 41, branchId: 3, userId: 5, status: 'SENT_TO_KITCHEN', financialStatus: 'UNPAID',
        invoiceNumber: null, discountCode: null, tableId: null, closedAt: null,
        payments: [], fiscalCreditNotes: [], items: [sentItem]
    };

    it('prepared cancel with a user-selected waste warehouse: no standalone lock and no re-routing', async () => {
        const { tx, sql } = recordingTx(preparedOrder);
        const { consume, seenAtConsume } = spyConsume(sql);

        await OrderService.cancelWithTransaction(tx as never, 41, 1, 8, 'Cliente se fue', { wasteWarehouseId: 2 });

        expect(warehouseLocks(seenAtConsume[0])).toEqual([]);
        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({
            warehouseId: 2,
            reference: 'WASTE-ORD-41',
            route: false,
            expectedBranchId: 3
        }));
    });

    it('prepared cancel with a configured default waste warehouse (PedidosYa) follows routing', async () => {
        const { tx, sql } = recordingTx(preparedOrder);
        const { consume } = spyConsume(sql);

        await OrderService.cancelWithTransaction(tx as never, 41, 1, 8, 'Cancelado por canal', {
            wasteWarehouseId: 2,
            wasteWarehouseIsDefault: true
        });

        expect(consume).toHaveBeenCalledWith(tx as never, expect.objectContaining({ warehouseId: 2, route: true }));
    });
});
