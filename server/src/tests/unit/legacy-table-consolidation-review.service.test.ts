import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { LegacyTableConsolidationReviewService } from '../../services/legacy-table-consolidation-review.service';
import prisma from '../../utils/prisma';

const cancelledAt = new Date('2026-07-20T12:00:00.000Z');

function orderState(overrides: Record<string, unknown>) {
    return {
        id: 10,
        branchId: 3,
        tableId: 30,
        status: 'OPEN',
        financialStatus: 'UNPAID',
        total: new Prisma.Decimal(50),
        discount: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        tipAmount: new Prisma.Decimal(0),
        channelCommission: new Prisma.Decimal(0),
        channelMarkup: new Prisma.Decimal(0),
        consolidatedIntoOrderId: null,
        cancelledById: null,
        cancelledAt: null,
        closedAt: null,
        cancelReason: null,
        ...overrides
    };
}

function mockInventoryData(options: { sourceStatus?: string; includeAudit?: boolean } = {}) {
    const primary = orderState({ id: 10, tableId: 30, total: new Prisma.Decimal(80) });
    const source = orderState({
        id: 20,
        tableId: 31,
        status: options.sourceStatus ?? 'CANCELLED',
        total: new Prisma.Decimal(0),
        consolidatedIntoOrderId: 10,
        cancelledById: 9,
        cancelledAt,
        closedAt: cancelledAt,
        cancelReason: 'Consolidada en orden #10'
    });
    const auditFindMany = jest.spyOn(prisma.auditLog, 'findMany').mockResolvedValue(
        options.includeAudit === false
            ? []
            : [{
                id: 70,
                entityId: 10,
                userId: 9,
                createdAt: new Date('2026-07-20T12:00:01.000Z'),
                details: {
                    destinationTableId: 30,
                    sourceTableIds: [31],
                    primaryOrderId: 10,
                    absorbedOrderIds: [20],
                    movedItemIds: [40],
                    reason: 'Cuenta familiar'
                }
            }] as never
    );
    const orderFindMany = jest.spyOn(prisma.order, 'findMany');
    orderFindMany
        .mockResolvedValueOnce([source] as never)
        .mockResolvedValueOnce([primary, source] as never);
    jest.spyOn(prisma.tableConsolidationOrder, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.legacyTableConsolidationReview, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([{
        id: 40,
        orderId: 10,
        originOrderId: 20,
        originTableId: 31
    }] as never);
    const tableFindMany = jest.spyOn(prisma.table, 'findMany').mockResolvedValue([
        { id: 30, branchId: 3 },
        { id: 31, branchId: 3 }
    ] as never);
    return { auditFindMany, orderFindMany, tableFindMany };
}

describe('legacy table consolidation inventory', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('classifies coherent legacy evidence as confirmed but not reversible', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');
        const { orderFindMany } = mockInventoryData();

        const result = await LegacyTableConsolidationReviewService.inventory(7, 3);

        expect(result.summary).toEqual({
            reversible: 0,
            notReversible: 1,
            ambiguous: 0,
            reviewed: 0,
            evidenceChangedAfterReview: 0
        });
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            classification: 'NOT_REVERSIBLE',
            reversible: false,
            branchId: 3,
            primaryOrderId: 10,
            absorbedOrderIds: [20],
            auditLogId: 70,
            reasons: ['ORIGINAL_ORDER_FINANCIALS_AND_STATUS_WERE_NOT_SNAPSHOTTED']
        }));
        expect(result.candidates[0].candidateKey).toMatch(/^[a-f0-9]{64}$/);
        expect(result.candidates[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/);
        expect(orderFindMany.mock.calls[0][0]).toEqual(expect.objectContaining({
            where: expect.objectContaining({ companyId: 7, branchId: 3 })
        }));
        expect(transaction).not.toHaveBeenCalled();
    });

    it('classifies missing or mutated evidence as ambiguous instead of reconstructing state', async () => {
        mockInventoryData({ sourceStatus: 'OPEN' });

        const result = await LegacyTableConsolidationReviewService.inventory(7);

        expect(result.summary.ambiguous).toBe(1);
        expect(result.summary.notReversible).toBe(0);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            reversible: false
        }));
        expect(result.candidates[0].reasons).toContain('absorbedRowsCancelled');
    });

    it('classifies a missing audited table as ambiguous', async () => {
        const { tableFindMany } = mockInventoryData();
        tableFindMany.mockResolvedValue([{ id: 30, branchId: 3 }] as never);

        const result = await LegacyTableConsolidationReviewService.inventory(7);

        expect(result.summary.notReversible).toBe(0);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            reversible: false
        }));
        expect(result.candidates[0].reasons).toEqual(expect.arrayContaining([
            'allAuditTablesPresent',
            'auditedTablesMatchOrderBranch'
        ]));
    });

    it('classifies an audited table from an incompatible branch as ambiguous', async () => {
        const { tableFindMany } = mockInventoryData();
        tableFindMany.mockResolvedValue([
            { id: 30, branchId: 3 },
            { id: 31, branchId: 4 }
        ] as never);

        const result = await LegacyTableConsolidationReviewService.inventory(7);

        expect(result.summary.notReversible).toBe(0);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            branchId: null
        }));
        expect(result.candidates[0].reasons).toEqual(expect.arrayContaining([
            'auditedTablesMatchOrderBranch',
            'branchUnambiguous'
        ]));
    });

    it('does not accept empty absorbed evidence through vacuous every checks', async () => {
        const { auditFindMany } = mockInventoryData();
        auditFindMany.mockResolvedValue([{
            id: 70,
            entityId: 10,
            userId: 9,
            createdAt: new Date('2026-07-20T12:00:01.000Z'),
            details: {
                destinationTableId: 30,
                sourceTableIds: [],
                primaryOrderId: 10,
                absorbedOrderIds: [],
                movedItemIds: [],
                reason: 'Auditoría incompleta'
            }
        }] as never);

        const result = await LegacyTableConsolidationReviewService.inventory(7);
        const auditedCandidate = result.candidates.find((candidate) => candidate.auditLogId === 70);

        expect(auditedCandidate).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            reversible: false
        }));
        expect(auditedCandidate?.reasons).toEqual(expect.arrayContaining([
            'hasAbsorbedOrders',
            'movedItemsPresent',
            'absorbedLinksIntact'
        ]));
    });

    it('reports orphan consolidation links as ambiguous when the audit is absent', async () => {
        mockInventoryData({ includeAudit: false });

        const result = await LegacyTableConsolidationReviewService.inventory(7);

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            auditLogId: null,
            reasons: ['TABLE_CONSOLIDATE_AUDIT_MISSING']
        }));
    });

    it('rejects malformed fingerprints before opening a write transaction', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(LegacyTableConsolidationReviewService.mark(
            7,
            9,
            3,
            'not-a-hash',
            {
                expectedEvidenceHash: 'also-invalid',
                resolutionKey: 'legacy-review-1',
                outcome: 'EXTERNAL_EVIDENCE_REQUIRED',
                note: 'Requiere documentos externos'
            }
        )).rejects.toThrow(/64 caracteres|SHA-256/i);

        expect(transaction).not.toHaveBeenCalled();
    });
});
