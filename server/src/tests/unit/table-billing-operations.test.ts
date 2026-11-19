import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { deriveAccountWorkflowStatus, TableAccountService } from '../../services/table-account.service';
import { SplitBillService } from '../../services/split-bill.service';

afterEach(() => {
    jest.restoreAllMocks();
});

const sent = new Date('2026-11-18T12:00:00Z');

describe('deriveAccountWorkflowStatus', () => {
    it('follows active kitchen batches first, then unsent drafts, then a released history', () => {
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }], batchStatuses: ['RELEASED', 'IN_PREPARATION'], legacyStatus: 'OPEN'
        })).toBe('IN_PREPARATION');
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }, { sentAt: null }], batchStatuses: ['PENDING'], legacyStatus: 'OPEN'
        })).toBe('SENT_TO_KITCHEN');
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }, { sentAt: null }], batchStatuses: ['READY'], legacyStatus: 'OPEN'
        })).toBe('READY');
        // OPEN draft + released wave: was merged to IN_PREPARATION (stuck, not in KDS).
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }, { sentAt: null }], batchStatuses: ['RELEASED'], legacyStatus: 'IN_PREPARATION'
        })).toBe('OPEN');
        // Every line sent and released: deliverable, so payment can auto-deliver.
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }, { sentAt: sent }], batchStatuses: ['RELEASED', 'RELEASED'], legacyStatus: 'IN_PREPARATION'
        })).toBe('READY');
        expect(deriveAccountWorkflowStatus({ items: [], batchStatuses: [], legacyStatus: 'READY' })).toBe('OPEN');
        // Pre-batch legacy data keeps the merged legacy status.
        expect(deriveAccountWorkflowStatus({
            items: [{ sentAt: sent }], batchStatuses: [], legacyStatus: 'SENT_TO_KITCHEN'
        })).toBe('SENT_TO_KITCHEN');
    });
});

function consolidationTx(orders: Array<Record<string, unknown>>) {
    const calls: string[] = [];
    const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
            calls.push(`raw:${strings.join('?').slice(0, 40)}`);
            return [];
        }),
        table: {
            findMany: jest.fn(async () => {
                calls.push('table.findMany');
                return [
                    { id: 1, branchId: 3, status: 'OCCUPIED', activeTableGroupId: null },
                    { id: 2, branchId: 3, status: 'OCCUPIED', activeTableGroupId: null }
                ];
            }),
            findFirst: jest.fn(async () => ({ activeTableGroupId: 10, status: 'OCCUPIED' })),
            update: jest.fn(async () => ({}))
        },
        order: {
            findMany: jest.fn(async () => {
                calls.push('order.findMany');
                return orders;
            }),
            update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
                id: where.id, updatedAt: new Date(), ...data
            }))
        },
        orderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
        tableConsolidation: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async () => ({ id: 50, version: 0 }))
        },
        auditLog: { create: jest.fn(async () => ({})) }
    };
    return { tx, calls };
}

function account(id: number, tableId: number, status: string, items: Array<{ id: number; sentAt: Date | null; subtotal: number }>, totals: { total: number; tax: number; tip: number }, batches: number) {
    return {
        id, tableId, status, financialStatus: 'UNPAID', invoiceNumber: null, preInvoicedAt: null, discountCode: null,
        total: totals.total, discount: 0, tax: totals.tax, tipAmount: totals.tip, channelCommission: 0, channelMarkup: 0,
        consolidatedIntoOrderId: null, cancelledById: null, cancelledAt: null, closedAt: null, cancelReason: null,
        payments: [], kitchenBatches: [], _count: { kitchenBatches: batches },
        items: items.map((item) => ({
            id: item.id, quantity: 1, price: item.subtotal, subtotal: item.subtotal, notes: null,
            status: item.sentAt ? 'DONE' : 'PENDING', sentAt: item.sentAt, startedAt: null, finishedAt: null,
            originOrderId: null, originTableId: null, modifiers: []
        }))
    };
}

describe('TableAccountService.consolidate', () => {
    it('locks every open account before the first plain read and sums 115.00 + 57.50 = 172.50', async () => {
        const { tx, calls } = consolidationTx([
            account(100, 1, 'READY', [{ id: 1, sentAt: sent, subtotal: 100 }], { total: 115, tax: 15, tip: 0 }, 1),
            account(200, 2, 'READY', [{ id: 2, sentAt: sent, subtotal: 50 }], { total: 57.5, tax: 7.5, tip: 0 }, 1)
        ]);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await TableAccountService.consolidate(1, 9, { destinationTableId: 1, sourceTableIds: [2] });

        const firstPlainRead = calls.indexOf('table.findMany');
        const accountLock = calls.findIndex((call) => call.includes('FROM `Order` WHERE companyId'));
        expect(accountLock).toBeGreaterThan(-1);
        expect(accountLock).toBeLessThan(firstPlainRead);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 100 },
            data: expect.objectContaining({ status: 'READY', tableId: 1 })
        }));
        const primaryUpdate = tx.order.update.mock.calls.find(([args]) => args.where.id === 100)![0];
        expect(Number(primaryUpdate.data.total)).toBe(172.5);
        expect(Number(primaryUpdate.data.tax)).toBe(22.5);
    });

    it('a draft line plus a released wave consolidates as OPEN, not a stuck IN_PREPARATION', async () => {
        const { tx } = consolidationTx([
            account(100, 1, 'OPEN', [{ id: 1, sentAt: null, subtotal: 10 }], { total: 11.5, tax: 1.5, tip: 0 }, 0),
            account(200, 2, 'READY', [{ id: 2, sentAt: sent, subtotal: 20 }], { total: 23, tax: 3, tip: 0 }, 1)
        ]);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await TableAccountService.consolidate(1, 9, { destinationTableId: 1, sourceTableIds: [2] });

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 100 },
            data: expect.objectContaining({ status: 'OPEN' })
        }));
    });
});

describe('SplitBillService with kitchen-voided rows', () => {
    it('only loads billable (quantity > 0) lines and stays scoped to the branch', async () => {
        const findFirst = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 1, total: 23, discount: 0, tax: 3, tipAmount: 0, payments: [],
            items: [{ id: 10, subtotal: 20, quantity: 2, price: 10, menuItem: { name: 'Taco' }, modifiers: [] }]
        } as never);

        const result = await SplitBillService.splitByItems(1, 7, [
            { personName: 'Ana', items: [{ orderItemId: 10, quantity: 1 }] },
            { personName: 'Beto', items: [{ orderItemId: 10, quantity: 1 }] }
        ], 3);

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 1, companyId: 7, branchId: 3 },
            include: expect.objectContaining({
                items: expect.objectContaining({ where: { quantity: { gt: 0 } } })
            })
        }));
        expect(result.splits.map((split) => split.total)).toEqual([11.5, 11.5]);
    });
});

describe('billing guards on voided rows', () => {
    it('fiscal documents, tickets and partial transfers ignore quantity-0 voided rows', () => {
        const invoice = fs.readFileSync(path.resolve(__dirname, '../../services/invoice.service.ts'), 'utf8');
        expect(invoice).toContain('order.items.filter((item) => item.quantity > 0).map((item) => ({');
        const tickets = fs.readFileSync(path.resolve(__dirname, '../../services/ticket-printing.service.ts'), 'utf8');
        expect(tickets.match(/order\.items\.filter\(\(item\) => item\.quantity > 0\)/g)?.length).toBe(2);
        const tableAccounts = fs.readFileSync(path.resolve(__dirname, '../../services/table-account.service.ts'), 'utf8');
        expect(tableAccounts).toContain('where: { orderId: order.id, quantity: { gt: 0 } }');
    });
});
