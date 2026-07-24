import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { TableController } from '../../controllers/table.controller';
import { TableAccountService } from '../../services/table-account.service';
import prisma from '../../utils/prisma';

const postConsolidationUpdatedAt = new Date('2026-07-23T12:00:00.000Z');

function orderSnapshot(orderId: number, tableId: number, isPrimary: boolean) {
    return {
        id: orderId,
        tableConsolidationId: 50,
        orderId,
        originalTableId: tableId,
        isPrimary,
        originalStatus: 'OPEN',
        originalFinancialStatus: 'UNPAID',
        originalTotal: isPrimary ? 100 : 50,
        originalDiscount: 0,
        originalTax: 0,
        originalTipAmount: 0,
        originalChannelCommission: 0,
        originalChannelMarkup: 0,
        originalConsolidatedIntoId: null,
        originalCancelledById: null,
        originalCancelledAt: null,
        originalClosedAt: null,
        originalCancelReason: null,
        postConsolidationUpdatedAt
    };
}

function activeConsolidation(overrides: Record<string, unknown> = {}) {
    return {
        id: 50,
        companyId: 1,
        branchId: 3,
        primaryOrderId: 100,
        destinationTableId: 10,
        status: 'ACTIVE',
        version: 0,
        reason: 'Unir cuenta familiar',
        createdById: 9,
        createdAt: new Date('2026-07-23T11:59:00.000Z'),
        reversedById: null,
        reversedAt: null,
        reversalReason: null,
        reversalKey: null,
        orderSnapshots: [
            orderSnapshot(100, 10, true),
            orderSnapshot(200, 11, false)
        ],
        itemSnapshots: [],
        ...overrides
    };
}

function currentOrders(primaryStatus = 'OPEN') {
    return [
        {
            id: 100,
            companyId: 1,
            branchId: 3,
            tableId: 10,
            status: primaryStatus,
            financialStatus: 'UNPAID',
            total: 150,
            discount: 0,
            tax: 0,
            tipAmount: 0,
            channelCommission: 0,
            channelMarkup: 0,
            consolidatedIntoOrderId: null,
            cancelledById: null,
            cancelledAt: null,
            closedAt: null,
            cancelReason: null,
            invoiceNumber: null,
            invoicedAt: null,
            invoiceFiscalStatus: 'NOT_ISSUED',
            updatedAt: postConsolidationUpdatedAt,
            payments: []
        },
        {
            id: 200,
            companyId: 1,
            branchId: 3,
            tableId: 11,
            status: 'CANCELLED',
            financialStatus: 'UNPAID',
            total: 0,
            discount: 0,
            tax: 0,
            tipAmount: 0,
            channelCommission: 0,
            channelMarkup: 0,
            consolidatedIntoOrderId: 100,
            cancelledById: 9,
            cancelledAt: postConsolidationUpdatedAt,
            closedAt: postConsolidationUpdatedAt,
            cancelReason: 'Consolidada en orden #100',
            invoiceNumber: null,
            invoicedAt: null,
            invoiceFiscalStatus: 'NOT_ISSUED',
            updatedAt: postConsolidationUpdatedAt,
            payments: []
        }
    ];
}

function reversalTx(options: {
    consolidation?: ReturnType<typeof activeConsolidation>;
    primaryStatus?: string;
    auditError?: Error;
    primaryPayment?: boolean;
    primaryInvoice?: boolean;
    competingAccount?: { id: number; tableId: number; status: string; financialStatus: string } | null;
} = {}) {
    const consolidation = options.consolidation ?? activeConsolidation();
    const orders = currentOrders(options.primaryStatus);
    if (options.primaryPayment) {
        (orders[0].payments as Array<{ id: number }>).push({ id: 900 });
    }
    if (options.primaryInvoice) {
        Object.assign(orders[0], {
            invoiceNumber: 'FAC-3-000001',
            invoicedAt: new Date('2026-07-23T12:01:00.000Z'),
            invoiceFiscalStatus: 'ISSUED'
        });
    }
    const findConsolidation = jest.fn<
        () => Promise<ReturnType<typeof activeConsolidation> | null>
    >();
    if (consolidation.status === 'REVERSED') {
        findConsolidation.mockResolvedValue(consolidation);
    } else {
        findConsolidation
            .mockResolvedValueOnce(consolidation)
            .mockResolvedValueOnce(null);
    }
    const tx = {
        $queryRaw: jest.fn(async () => []),
        tableConsolidation: {
            findFirst: findConsolidation,
            updateMany: jest.fn(async (_args: unknown) => ({ count: 1 }))
        },
        table: {
            findMany: jest.fn(async () => [
                { id: 10, branchId: 3, status: 'OCCUPIED', activeTableGroupId: null },
                { id: 11, branchId: 3, status: 'OCCUPIED', activeTableGroupId: null }
            ]),
            findFirst: jest.fn(async ({ where }: { where: { id: number } }) => ({
                activeTableGroupId: null,
                status: 'OCCUPIED',
                id: where.id
            })),
            update: jest.fn(async () => ({}))
        },
        order: {
            findMany: jest.fn<() => Promise<ReturnType<typeof currentOrders>>>()
                .mockResolvedValueOnce(orders)
                .mockResolvedValueOnce(orders),
            findFirst: jest.fn(async () => options.competingAccount ?? null),
            count: jest.fn(async () => 1),
            update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
                id: where.id,
                ...data
            }))
        },
        orderItem: {
            findMany: jest.fn(async () => []),
            count: jest.fn(async () => 0),
            updateMany: jest.fn(async () => ({ count: 1 }))
        },
        auditLog: {
            create: options.auditError
                ? jest.fn(async (_args: unknown) => { throw options.auditError; })
                : jest.fn(async (_args: unknown) => ({ id: 1 }))
        }
    };
    return tx;
}

describe('table consolidation reversal', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('restores all order snapshots, claims the version and audits in one transaction', async () => {
        const tx = reversalTx();
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        const result = await TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'reverse-50-attempt-1',
            reason: 'Separación solicitada antes de cobrar'
        });

        expect(result.idempotent).toBe(false);
        expect(tx.order.update).toHaveBeenCalledTimes(2);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 200 },
            data: expect.objectContaining({
                tableId: 11,
                status: 'OPEN',
                total: 50,
                consolidatedIntoOrderId: null,
                cancelledById: null,
                cancelledAt: null,
                closedAt: null,
                cancelReason: null
            })
        }));
        expect(tx.tableConsolidation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 50, companyId: 1, status: 'ACTIVE', version: 0 },
            data: expect.objectContaining({
                status: 'REVERSED',
                reversedById: 15,
                reversalKey: 'reverse-50-attempt-1'
            })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                companyId: 1,
                entityType: 'TableConsolidation',
                entityId: 50,
                action: 'TABLE_CONSOLIDATION_REVERSE',
                userId: 15
            })
        }));
    });

    it('returns an idempotent result only for the same durable key and reason', async () => {
        const tx = reversalTx({
            consolidation: activeConsolidation({
                status: 'REVERSED',
                version: 1,
                reversalKey: 'reverse-50-attempt-1',
                reversalReason: 'Separación solicitada antes de cobrar'
            })
        });
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        const result = await TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'reverse-50-attempt-1',
            reason: 'Separación solicitada antes de cobrar'
        });

        expect(result.idempotent).toBe(true);
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.tableConsolidation.updateMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();

        await expect(TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'another-key-50',
            reason: 'Separación solicitada antes de cobrar'
        })).rejects.toThrow(/otra clave o motivo/i);
    });

    it('blocks a delivered-unpaid consolidated account before any restoration', async () => {
        const tx = reversalTx({ primaryStatus: 'DELIVERED' });
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'reverse-50-delivered',
            reason: 'Intento posterior a entrega'
        })).rejects.toThrow(/después de entregar/i);

        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.tableConsolidation.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ['payment history', { primaryPayment: true }, /historial de pago/i],
        ['fiscal history', { primaryInvoice: true }, /historia fiscal/i],
        ['another delivered-unpaid account', {
            competingAccount: { id: 300, tableId: 11, status: 'DELIVERED', financialStatus: 'UNPAID' }
        }, /otra cuenta activa o entregada pendiente/i]
    ])('blocks %s without restoring any order', async (_label, options, expectedMessage) => {
        const tx = reversalTx(options);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'reverse-50-blocked',
            reason: 'Separación solicitada antes de cobrar'
        })).rejects.toThrow(expectedMessage);

        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.tableConsolidation.updateMany).not.toHaveBeenCalled();
    });

    it('propagates an audit failure so the enclosing database transaction rolls back', async () => {
        const tx = reversalTx({ auditError: new Error('audit unavailable') });
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(TableAccountService.reverseConsolidation(1, 15, 50, {
            expectedVersion: 0,
            reversalKey: 'reverse-50-audit',
            reason: 'Separación solicitada antes de cobrar'
        })).rejects.toThrow('audit unavailable');
    });

    it('finds only an active tenant-scoped record and returns a minimal UI contract', async () => {
        const findFirst = jest.spyOn(prisma.tableConsolidation, 'findFirst').mockResolvedValue({
            id: 50,
            branchId: 3,
            primaryOrderId: 100,
            destinationTableId: 10,
            status: 'ACTIVE',
            version: 0,
            reason: 'Unir cuenta familiar',
            createdAt: new Date('2026-07-23T11:59:00.000Z'),
            orderSnapshots: [
                { orderId: 100, originalTableId: 10 },
                { orderId: 200, originalTableId: 11 }
            ]
        } as never);

        const result = await TableAccountService.findActiveConsolidation(7, { orderId: 100 });

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 7, status: 'ACTIVE' })
        }));
        expect(result).toEqual(expect.objectContaining({
            id: 50,
            version: 0,
            affectedOrderIds: [100, 200],
            originalTableIds: [10, 11]
        }));
        expect(result).not.toHaveProperty('orderSnapshots');
        await expect(TableAccountService.findActiveConsolidation(7, {}))
            .rejects.toThrow(/exactamente orderId o tableId/i);
        await expect(TableAccountService.findActiveConsolidation(7, { orderId: 100, tableId: 10 }))
            .rejects.toThrow(/exactamente orderId o tableId/i);
    });

    it('does not expose an active consolidation from another branch to an operational user', async () => {
        jest.spyOn(TableAccountService, 'findActiveConsolidation').mockResolvedValue({
            id: 50,
            branchId: 8,
            primaryOrderId: 100,
            destinationTableId: 10,
            status: 'ACTIVE',
            version: 0,
            reason: null,
            createdAt: new Date(),
            affectedOrderIds: [100, 200],
            originalTableIds: [10, 11]
        });
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;
        const req = {
            query: { orderId: '100' },
            user: {
                userId: 15,
                companyId: 1,
                branchId: 3,
                role: 'CAJERO',
                roles: ['CAJERO'],
                permissions: ['tables.consolidate']
            }
        } as unknown as Request;

        await TableController.getActiveConsolidation(
            req,
            { json } as unknown as Response,
            next
        );

        expect(json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            name: 'BranchScopeError',
            statusCode: 403
        }));
    });
});
