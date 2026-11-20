import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { OrderController } from '../../controllers/order.controller';
import { WebSocketService } from '../../services/websocket.service';

afterEach(() => {
    jest.restoreAllMocks();
});

type Row = Record<string, unknown>;

function useTx<T extends object>(tx: T) {
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: T) => unknown) => callback(tx)) as never
    );
}

const taxSettings = () => ({
    findMany: jest.fn(async () => [{ name: '1_tax_rate', value: '15' }]),
    findUnique: jest.fn(async () => ({ value: '15' })),
});

// -- create stores guests ----------------------------------------------------
describe('OrderService.create guests', () => {
    function createTx(existing: Row | null = null) {
        return {
            branch: { findFirst: jest.fn(async () => ({ id: 3 })) },
            $queryRaw: jest.fn(async () => []),
            table: {
                findFirst: jest.fn(async () => ({ id: 9, branchId: 3, status: 'AVAILABLE', activeTableGroupId: null })),
                update: jest.fn(async () => ({})),
            },
            reservation: { findMany: jest.fn(async () => []) },
            order: {
                findFirst: jest.fn(async () => existing),
                create: jest.fn(async (_a: unknown) => ({ id: 70, discount: 0, tipAmount: 0, branchId: 3, total: 0 })),
                update: jest.fn(async (_a: unknown) => ({})),
                findUnique: jest.fn(async () => ({ id: 70, guests: 4 })),
            },
        };
    }

    it('create stores guests', async () => {
        const tx = createTx();
        useTx(tx);
        await OrderService.create(1, { branchId: 3, userId: 5, guests: 4 } as never);
        expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ guests: 4 })
        }));
    });

    it('create without guests leaves the column untouched', async () => {
        const tx = createTx();
        useTx(tx);
        await OrderService.create(1, { branchId: 3, userId: 5 });
        const data = (tx.order.create.mock.calls[0][0] as { data: Row }).data;
        expect('guests' in data).toBe(false);
    });

    it('create rejects guests outside 1..99', async () => {
        const tx = createTx();
        useTx(tx);
        await expect(OrderService.create(1, { branchId: 3, userId: 5, guests: 0 } as never)).rejects.toThrow(/personas/i);
        await expect(OrderService.create(1, { branchId: 3, userId: 5, guests: 100 } as never)).rejects.toThrow(/personas/i);
        await expect(OrderService.create(1, { branchId: 3, userId: 5, guests: 2.5 } as never)).rejects.toThrow(/personas/i);
    });

    it('reusing the table order updates its guests when provided', async () => {
        const tx = createTx({
            id: 55, branchId: 3, status: 'OPEN', invoiceNumber: null, preInvoicedAt: null, items: [], payments: [], guests: null,
        });
        useTx(tx);
        const result = await OrderService.create(1, { branchId: 3, tableId: 9, userId: 5, guests: 3 } as never) as Row;
        expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { guests: 3 } });
        expect(result.guests).toBe(3);
    });
});

// -- PATCH guests ------------------------------------------------------------
describe('OrderService.setGuests', () => {
    it('updates guests on an open order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ id: 41, status: 'OPEN', branchId: 3 })),
                update: jest.fn(async (_a: unknown) => ({ id: 41, guests: 6 })),
            },
        };
        useTx(tx);
        await OrderService.setGuests(41, 1, 6);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 41 }, data: { guests: 6 } }));
    });

    it('rejects out of range guests and cancelled orders', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: { findFirst: jest.fn(async () => ({ id: 41, status: 'CANCELLED' })), update: jest.fn() },
        };
        useTx(tx);
        await expect(OrderService.setGuests(41, 1, 0)).rejects.toThrow(/personas/i);
        await expect(OrderService.setGuests(41, 1, 100)).rejects.toThrow(/personas/i);
        await expect(OrderService.setGuests(41, 1, 4)).rejects.toThrow(/cancelad/i);
        expect(tx.order.update).not.toHaveBeenCalled();
    });
});

// -- PATCH items/:itemId -----------------------------------------------------
function updateTx(over: { item?: Row | null; order?: Row; subtotals?: number[] } = {}) {
    const order = {
        id: 41, companyId: 1, branchId: 3, status: 'OPEN', invoiceNumber: null, preInvoicedAt: null,
        discount: 0, discountCode: null, tipAmount: 0, payments: [], ...over.order,
    };
    const item = over.item === undefined ? {
        id: 10, orderId: 41, menuItemId: 3, quantity: 1, price: 12.5, subtotal: 12.5, notes: null,
        sentAt: null, voidedAt: null, order,
    } : over.item && { ...over.item, order };
    return {
        $queryRaw: jest.fn(async () => []),
        orderItem: {
            findFirst: jest.fn(async (_a: unknown) => (item ? { orderId: 41 } : null)),
            findUnique: jest.fn(async () => item),
            update: jest.fn(async (args: { data: Row }) => ({ ...(item as Row), ...args.data })),
            findMany: jest.fn(async () => (over.subtotals ?? [25]).map((subtotal) => ({ subtotal }))),
        },
        order: { update: jest.fn(async (_a: unknown) => ({})) },
        kitchenBatch: { count: jest.fn(async () => 0) },
        setting: taxSettings(),
        promotion: { findFirst: jest.fn(async () => null) },
    };
}

describe('OrderService.updateItem', () => {
    it('update unsent item quantity reprices the order', async () => {
        const tx = updateTx({ subtotals: [25] });
        useTx(tx);
        const result = await OrderService.updateItem(10, 1, 3, { quantity: 2 });
        expect(tx.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 10 },
            data: expect.objectContaining({ quantity: 2, subtotal: 25 }),
        }));
        // subtotal 25, tax 15 % = 3.75 -> total 28.75
        expect(tx.order.update).toHaveBeenCalledWith({
            where: { id: 41 },
            data: { total: 28.75, discount: 0, tax: 3.75 },
        });
        expect(result.orderId).toBe(41);
    });

    it('update changes notes only without touching quantity or price', async () => {
        const tx = updateTx();
        useTx(tx);
        await OrderService.updateItem(10, 1, 3, { notes: 'sin cebolla' });
        const data = (tx.orderItem.update.mock.calls[0][0] as { data: Row }).data;
        expect(data).toEqual({ notes: 'sin cebolla' });
    });

    it('update rejects a sent item with a clear message', async () => {
        const tx = updateTx({ item: { id: 10, orderId: 41, menuItemId: 3, quantity: 1, price: 12.5, subtotal: 12.5, sentAt: new Date(), voidedAt: null } });
        useTx(tx);
        await expect(OrderService.updateItem(10, 1, 3, { quantity: 2 }))
            .rejects.toThrow(/ya enviad[oa] a cocina/i);
        expect(tx.orderItem.update).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it.each([
        ['prefactura', { preInvoicedAt: new Date() }],
        ['factura', { invoiceNumber: 'F-1' }],
        ['pagos activos', { payments: [{ id: 1 }] }],
        ['orden cancelada', { status: 'CANCELLED' }],
        ['orden entregada', { status: 'DELIVERED' }],
    ])('update is blocked like addItem: %s', async (_name, order) => {
        const tx = updateTx({ order });
        useTx(tx);
        await expect(OrderService.updateItem(10, 1, 3, { quantity: 2 })).rejects.toThrow();
        expect(tx.orderItem.update).not.toHaveBeenCalled();
    });

    it('update validates input', async () => {
        const tx = updateTx();
        useTx(tx);
        await expect(OrderService.updateItem(10, 1, 3, {})).rejects.toThrow(/cantidad|notas/i);
        await expect(OrderService.updateItem(10, 1, 3, { quantity: 0 })).rejects.toThrow(/cantidad/i);
        await expect(OrderService.updateItem(10, 1, 3, { quantity: 1.5 })).rejects.toThrow(/cantidad/i);
        await expect(OrderService.updateItem(10, 1, 3, { notes: 'x'.repeat(201) })).rejects.toThrow(/200/);
        expect(tx.orderItem.update).not.toHaveBeenCalled();
    });

    it('update is scoped by company and branch (other branch looks like not found)', async () => {
        const tx = updateTx({ item: null });
        useTx(tx);
        await expect(OrderService.updateItem(10, 1, 3, { quantity: 2 })).rejects.toThrow(/no encontrada/i);
        expect(tx.orderItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 10, order: { companyId: 1, branchId: 3 } },
        }));
    });
});

// -- POST :id/items/deliver --------------------------------------------------
function deliverTx(lines: Row[], orderOver: Row = {}) {
    const order = { id: 41, companyId: 1, branchId: 3, status: 'READY', ...orderOver };
    return {
        $queryRaw: jest.fn(async () => []),
        order: { findFirst: jest.fn(async (_a: unknown) => order as Row | null) },
        orderItem: {
            findMany: jest.fn(async (_a: unknown) => lines),
            updateMany: jest.fn(async (args: { where: Row & { id: { in: number[] } }; data?: Row }) => ({ count: args.where.id.in.length })),
        },
    };
}

const line = (id: number, over: Row = {}) => ({
    id, orderId: 41, status: 'DONE', voidedAt: null, quantity: 1, deliveredAt: null, ...over,
});

describe('OrderService.deliverItems', () => {
    it('deliver marks only DONE lines and is idempotent', async () => {
        const lines = [
            line(1),
            line(2, { status: 'IN_PROGRESS' }),
            line(3, { status: 'PENDING' }),
            line(4, { deliveredAt: new Date('2026-11-20T10:00:00Z') }),
        ];
        const tx = deliverTx(lines);
        useTx(tx);

        const first = await OrderService.deliverItems(41, 1, 8, [1, 2, 3, 4, 999]);
        expect(first.delivered).toEqual([1]);
        expect([...first.skipped].sort((a, b) => a - b)).toEqual([2, 3, 4, 999]);
        expect(tx.orderItem.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
            where: { id: { in: [1] }, orderId: 41, status: 'DONE', voidedAt: null, deliveredAt: null },
            data: { deliveredAt: expect.any(Date), deliveredById: 8 },
        });

        // Replay: line 1 is now delivered -> nothing to write, nothing changes.
        const replayTx = deliverTx([line(1, { deliveredAt: new Date() }), ...lines.slice(1)]);
        useTx(replayTx);
        const second = await OrderService.deliverItems(41, 1, 8, [1, 2, 3, 4, 999]);
        expect(second.delivered).toEqual([]);
        expect([...second.skipped].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 999]);
        expect(replayTx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('deliver of a voided line is skipped', async () => {
        const tx = deliverTx([
            line(5, { voidedAt: new Date(), quantity: 0 }),
            line(6, { quantity: 0 }),
        ]);
        useTx(tx);
        const result = await OrderService.deliverItems(41, 1, 8, [5, 6]);
        expect(result).toEqual({ delivered: [], skipped: [5, 6] });
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('deliver only looks at lines of this order and company, and dedupes ids', async () => {
        const tx = deliverTx([line(1)]);
        useTx(tx);
        const result = await OrderService.deliverItems(41, 1, 8, [1, 1, 1]);
        expect(result).toEqual({ delivered: [1], skipped: [] });
        expect(tx.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: { in: [1] }, orderId: 41 },
        }));
        expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 41, companyId: 1 } }));
    });

    it('deliver rejects bad input and cancelled orders', async () => {
        const tx = deliverTx([line(1)], { status: 'CANCELLED' });
        useTx(tx);
        await expect(OrderService.deliverItems(41, 1, 8, [])).rejects.toThrow(/líneas/i);
        await expect(OrderService.deliverItems(41, 1, 8, Array.from({ length: 101 }, (_, i) => i + 1))).rejects.toThrow(/líneas/i);
        await expect(OrderService.deliverItems(41, 1, 8, [0])).rejects.toThrow(/líneas/i);
        await expect(OrderService.deliverItems(41, 1, 8, [1])).rejects.toThrow(/cancelad/i);
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('deliver of an order from another company is not found', async () => {
        const tx = deliverTx([line(1)]);
        tx.order.findFirst = jest.fn(async (_a: unknown) => null);
        useTx(tx);
        await expect(OrderService.deliverItems(41, 2, 8, [1])).rejects.toThrow(/no encontrada/i);
    });
});

// -- WS events ---------------------------------------------------------------
function mockRes() {
    const res: Record<string, unknown> = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res as never;
}
const reqFor = (over: Row = {}) => ({
    user: { companyId: 1, branchId: 3, userId: 8, role: 'MESERO', roles: ['MESERO'] },
    params: {},
    body: {},
    headers: {},
    ...over,
}) as never;

const fullOrder = { id: 41, branchId: 3, companyId: 1, items: [] };

describe('order WS events', () => {
    it('addItem, updateItem, removeItem emit ORDER_UPDATE ITEMS_CHANGED', async () => {
        const emit = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue(fullOrder as never);
        jest.spyOn(OrderService, 'addItem').mockResolvedValue({ id: 10, orderId: 41 } as never);
        jest.spyOn(OrderService, 'updateItem').mockResolvedValue({ id: 10, orderId: 41 } as never);
        jest.spyOn(OrderService, 'removeItem').mockResolvedValue({ success: true, orderId: 41 } as never);

        await OrderController.addItem(reqFor({ params: { id: '41' }, body: { menuItemId: 3, quantity: 1 } }), mockRes(), jest.fn());
        await OrderController.updateItem(reqFor({ params: { itemId: '10' }, body: { quantity: 2 } }), mockRes(), jest.fn());
        await OrderController.removeItem(reqFor({ params: { itemId: '10' } }), mockRes(), jest.fn());

        expect(emit).toHaveBeenCalledTimes(3);
        for (const call of emit.mock.calls) {
            expect(call[0]).toBe(41);
            expect(call[1]).toBe('ITEMS_CHANGED');
            expect(call[2]).toBe(fullOrder);
            expect(call[3]).toEqual({ companyId: 1, branchId: 3 });
        }
    });

    it('a failed mutation emits nothing and a failed emit does not fail the request', async () => {
        const emit = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue(fullOrder as never);
        const update = jest.spyOn(OrderService, 'updateItem').mockRejectedValue(new Error('ya enviado'));
        const next = jest.fn();
        await OrderController.updateItem(reqFor({ params: { itemId: '10' }, body: { quantity: 2 } }), mockRes(), next);
        expect(emit).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'ya enviado' }));

        update.mockResolvedValue({ id: 10, orderId: 41 } as never);
        emit.mockImplementation(() => { throw new Error('ws down'); });
        const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = mockRes();
        const next2 = jest.fn();
        await OrderController.updateItem(reqFor({ params: { itemId: '10' }, body: { quantity: 2 } }), res, next2);
        expect(next2).not.toHaveBeenCalled();
        expect(logged).toHaveBeenCalled();
        expect((res as unknown as { json: jest.Mock }).json).toHaveBeenCalled();
    });

    it('updateItem for a user without an active branch is refused before touching the service', async () => {
        const update = jest.spyOn(OrderService, 'updateItem');
        const next = jest.fn();
        await OrderController.updateItem(
            reqFor({ user: { companyId: 1, branchId: null, userId: 8, role: 'MESERO', roles: ['MESERO'] }, params: { itemId: '10' }, body: { quantity: 2 } }),
            mockRes(), next
        );
        expect(update).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('send-to-kitchen emits ORDER_UPDATE SENT_TO_KITCHEN once even when replayed with nothing unsent', async () => {
        const emit = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        const kitchen = jest.spyOn(WebSocketService, 'broadcastOrderToKitchen').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue(fullOrder as never);
        const send = jest.spyOn(OrderService, 'sendToKitchen');

        send.mockResolvedValueOnce({ id: 41, branchId: 3, kitchenBatchSent: true } as never);
        await OrderController.sendToKitchen(reqFor({ params: { id: '41' } }), mockRes(), jest.fn());
        send.mockResolvedValueOnce({ id: 41, branchId: 3, kitchenBatchSent: false } as never);
        await OrderController.sendToKitchen(reqFor({ params: { id: '41' } }), mockRes(), jest.fn());

        expect(kitchen).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(41, 'SENT_TO_KITCHEN', fullOrder, { companyId: 1, branchId: 3 });
    });

    it('deliver emits ITEMS_DELIVERED only when something was delivered', async () => {
        const emit = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue(fullOrder as never);
        const deliver = jest.spyOn(OrderService, 'deliverItems');
        const res1 = mockRes();
        deliver.mockResolvedValueOnce({ delivered: [1], skipped: [2] });
        await OrderController.deliverItems(reqFor({ params: { id: '41' }, body: { itemIds: [1, 2] } }), res1, jest.fn());
        expect((res1 as unknown as { json: jest.Mock }).json).toHaveBeenCalledWith(expect.objectContaining({
            success: true, data: { delivered: [1], skipped: [2] },
        }));
        deliver.mockResolvedValueOnce({ delivered: [], skipped: [1, 2] });
        await OrderController.deliverItems(reqFor({ params: { id: '41' }, body: { itemIds: [1, 2] } }), mockRes(), jest.fn());

        expect(deliver).toHaveBeenCalledWith(41, 1, 8, [1, 2]);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(41, 'ITEMS_DELIVERED', fullOrder, { companyId: 1, branchId: 3 });
    });

    it('deliver and guests refuse an order of another branch', async () => {
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ ...fullOrder, branchId: 9 } as never);
        const deliver = jest.spyOn(OrderService, 'deliverItems');
        const guests = jest.spyOn(OrderService, 'setGuests');
        const next = jest.fn();
        await OrderController.deliverItems(reqFor({ params: { id: '41' }, body: { itemIds: [1] } }), mockRes(), next);
        await OrderController.updateGuests(reqFor({ params: { id: '41' }, body: { guests: 3 } }), mockRes(), next);
        expect(deliver).not.toHaveBeenCalled();
        expect(guests).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(2);
    });

    it('guests emits GUESTS_CHANGED', async () => {
        const emit = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue(fullOrder as never);
        jest.spyOn(OrderService, 'setGuests').mockResolvedValue({ id: 41, guests: 5 } as never);
        await OrderController.updateGuests(reqFor({ params: { id: '41' }, body: { guests: 5 } }), mockRes(), jest.fn());
        expect(emit).toHaveBeenCalledWith(41, 'GUESTS_CHANGED', fullOrder, { companyId: 1, branchId: 3 });
    });
});

// -- reads expose the new fields ---------------------------------------------
describe('order reads', () => {
    it('GET /orders/:id includes item modifiers', async () => {
        const findFirst = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 41, items: [], fiscalCreditNotes: [],
        } as never);
        await OrderService.getById(41, 1);
        const include = (findFirst.mock.calls[0][0] as unknown as { include: { items: { include: Row } } }).include;
        expect(include.items.include.modifiers).toBe(true);
        expect(include.items.include.menuItem).toBeDefined();
    });
});

// -- routing: the new static paths must not be shadowed -----------------------
describe('order routes', () => {
    type RouterLayer = { match: (p: string) => boolean; route?: { path: string; methods: Record<string, boolean> } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const router = require('../../routes/order.routes').default as { stack: RouterLayer[] };
    const firstMatch = (method: string, path: string) => router.stack.find(
        (l) => l.route && l.route.methods[method] && l.match(path)
    )?.route?.path;

    it('routes the new endpoints to themselves, not to a param route', () => {
        expect(firstMatch('patch', '/items/10')).toBe('/items/:itemId');
        expect(firstMatch('delete', '/items/10')).toBe('/items/:itemId');
        expect(firstMatch('post', '/41/items/deliver')).toBe('/:id/items/deliver');
        expect(firstMatch('patch', '/41/guests')).toBe('/:id/guests');
        // existing routes keep their targets
        expect(firstMatch('post', '/41/items')).toBe('/:id/items');
        expect(firstMatch('post', '/41/items/10/void')).toBe('/:id/items/:itemId/void');
        expect(firstMatch('patch', '/41/items/10/start')).toBe('/:id/items/:itemId/start');
    });
});
