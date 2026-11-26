import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

type Tx = Prisma.TransactionClient;
type LegacyDb = Pick<
    Tx,
    | 'auditLog'
    | 'legacyTableConsolidationReview'
    | 'order'
    | 'orderItem'
    | 'table'
    | 'tableConsolidationOrder'
>;

type LegacyClassification = 'NOT_REVERSIBLE' | 'AMBIGUOUS';
type LegacyOutcome =
    | 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL'
    | 'EXTERNAL_EVIDENCE_REQUIRED';

type JsonRecord = Record<string, unknown>;

interface LegacyEvidence {
    source: 'LEGACY_AUDIT' | 'ORPHAN_ORDER_LINKS';
    auditLogId: number | null;
    auditCreatedAt: string | null;
    auditUserId: number | null;
    primaryOrderId: number | null;
    destinationTableId: number | null;
    sourceTableIds: number[];
    absorbedOrderIds: number[];
    auditMovedItemIds: number[];
    currentMovedItems: Array<{
        id: number;
        orderId: number;
        originOrderId: number | null;
        originTableId: number | null;
    }>;
    orderStates: Array<{
        id: number;
        branchId: number;
        tableId: number | null;
        status: string;
        financialStatus: string;
        total: string;
        discount: string;
        tax: string;
        tipAmount: string;
        channelCommission: string;
        channelMarkup: string;
        consolidatedIntoOrderId: number | null;
        cancelledById: number | null;
        cancelledAt: string | null;
        closedAt: string | null;
        cancelReason: string | null;
    }>;
    checks: Record<string, boolean>;
}

export interface LegacyConsolidationCandidate {
    candidateKey: string;
    evidenceHash: string;
    classification: LegacyClassification;
    reversible: false;
    branchId: number | null;
    primaryOrderId: number | null;
    absorbedOrderIds: number[];
    auditLogId: number | null;
    reasons: string[];
    evidence: LegacyEvidence;
    reviewHistoryCount: number;
    currentEvidenceReviewed: boolean;
    review: null | {
        id: number;
        revision: number;
        evidenceHash: string;
        classification: string;
        outcome: string;
        note: string;
        resolutionKey: string;
        reviewedById: number;
        reviewedAt: Date;
        evidenceChangedAfterReview: boolean;
    };
}

function asRecord(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null;
}

function positiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveIntegerArray(value: unknown): number[] | null {
    if (!Array.isArray(value)) return null;
    const parsed = value.map(positiveInteger);
    if (parsed.some((entry) => entry === null)) return null;
    const ids = parsed as number[];
    return new Set(ids).size === ids.length ? ids : null;
}

function cents(value: Prisma.Decimal | number | string): number {
    return Math.round(Number(value) * 100);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as JsonRecord)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, canonicalize(child)])
        );
    }
    return value;
}

function sha256(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalize(value)))
        .digest('hex');
}

function sameIds(left: number[], right: number[]): boolean {
    const sortedLeft = [...left].sort((a, b) => a - b);
    const sortedRight = [...right].sort((a, b) => a - b);
    return sortedLeft.length === sortedRight.length
        && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function trimText(value: unknown, min: number, max: number, label: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < min || text.length > max) {
        throw new Error(`${label} debe tener entre ${min} y ${max} caracteres`);
    }
    return text;
}

async function buildInventory(
    db: LegacyDb,
    companyId: number,
    branchId?: number
): Promise<LegacyConsolidationCandidate[]> {
    const [audits, linkedSources, snapshottedOrders, reviews] = await Promise.all([
        db.auditLog.findMany({
            where: { companyId, action: 'TABLE_CONSOLIDATE' },
            select: { id: true, entityId: true, userId: true, details: true, createdAt: true },
            orderBy: { id: 'asc' }
        }),
        db.order.findMany({
            where: {
                companyId,
                consolidatedIntoOrderId: { not: null },
                ...(branchId !== undefined ? { branchId } : {})
            },
            select: {
                id: true,
                branchId: true,
                tableId: true,
                status: true,
                financialStatus: true,
                total: true,
                discount: true,
                tax: true,
                tipAmount: true,
                channelCommission: true,
                channelMarkup: true,
                consolidatedIntoOrderId: true,
                cancelledById: true,
                cancelledAt: true,
                closedAt: true,
                cancelReason: true
            },
            orderBy: { id: 'asc' }
        }),
        db.tableConsolidationOrder.findMany({
            where: { consolidation: { companyId } },
            select: { orderId: true }
        }),
        db.legacyTableConsolidationReview.findMany({
            where: { companyId },
            orderBy: { id: 'asc' }
        })
    ]);

    const snapshotOrderIds = new Set(snapshottedOrders.map((entry) => entry.orderId));
    const legacySources = linkedSources.filter((order) => !snapshotOrderIds.has(order.id));
    const sourceIds = new Set(legacySources.map((order) => order.id));
    const parsedAudits = audits
        .map((audit) => {
            const details = asRecord(audit.details);
            const consolidationId = positiveInteger(details?.consolidationId);
            return {
                ...audit,
                details,
                modern: consolidationId !== null,
                primaryOrderId: positiveInteger(details?.primaryOrderId),
                destinationTableId: positiveInteger(details?.destinationTableId),
                sourceTableIds: positiveIntegerArray(details?.sourceTableIds),
                absorbedOrderIds: positiveIntegerArray(details?.absorbedOrderIds),
                movedItemIds: positiveIntegerArray(details?.movedItemIds)
            };
        })
        .filter((audit) => !audit.modern);

    const auditOrderIds = parsedAudits.flatMap((audit) => [
        ...(audit.primaryOrderId ? [audit.primaryOrderId] : []),
        ...(audit.absorbedOrderIds ?? [])
    ]);
    const primaryIds = legacySources
        .map((order) => order.consolidatedIntoOrderId)
        .filter((id): id is number => id !== null);
    const allOrderIds = [...new Set([...sourceIds, ...auditOrderIds, ...primaryIds])];
    const auditTableIds = parsedAudits.flatMap((audit) => [
        ...(audit.destinationTableId ? [audit.destinationTableId] : []),
        ...(audit.sourceTableIds ?? [])
    ]);
    const orderTableIds = legacySources
        .map((order) => order.tableId)
        .filter((id): id is number => id !== null);

    const [orders, movedItems, tables] = await Promise.all([
        allOrderIds.length
            ? db.order.findMany({
                where: { companyId, id: { in: allOrderIds } },
                select: {
                    id: true,
                    branchId: true,
                    tableId: true,
                    status: true,
                    financialStatus: true,
                    total: true,
                    discount: true,
                    tax: true,
                    tipAmount: true,
                    channelCommission: true,
                    channelMarkup: true,
                    consolidatedIntoOrderId: true,
                    cancelledById: true,
                    cancelledAt: true,
                    closedAt: true,
                    cancelReason: true
                }
            })
            : Promise.resolve([]),
        sourceIds.size
            ? db.orderItem.findMany({
                where: { originOrderId: { in: [...sourceIds] } },
                select: { id: true, orderId: true, originOrderId: true, originTableId: true },
                orderBy: { id: 'asc' }
            })
            : Promise.resolve([]),
        auditTableIds.length || orderTableIds.length
            ? db.table.findMany({
                where: {
                    companyId,
                    id: { in: [...new Set([...auditTableIds, ...orderTableIds])] }
                },
                select: { id: true, branchId: true }
            })
            : Promise.resolve([])
    ]);

    const orderById = new Map(orders.map((order) => [order.id, order]));
    const tableById = new Map(tables.map((table) => [table.id, table]));
    const reviewsByCandidate = new Map<string, typeof reviews>();
    for (const review of reviews) {
        const history = reviewsByCandidate.get(review.candidateKey) ?? [];
        history.push(review);
        reviewsByCandidate.set(review.candidateKey, history);
    }
    const reviewState = (candidateKey: string, evidenceHash: string) => {
        const history = reviewsByCandidate.get(candidateKey) ?? [];
        const latest = history.length > 0 ? history[history.length - 1] : undefined;
        const current = history.find((review) => review.evidenceHash === evidenceHash);
        return {
            history,
            latest,
            current
        };
    };
    const auditCountBySource = new Map<number, number>();
    for (const audit of parsedAudits) {
        for (const sourceId of audit.absorbedOrderIds ?? []) {
            auditCountBySource.set(sourceId, (auditCountBySource.get(sourceId) ?? 0) + 1);
        }
    }

    const claimedSourceIds = new Set<number>();
    const candidates: LegacyConsolidationCandidate[] = [];

    for (const audit of parsedAudits) {
        const absorbedOrderIds = audit.absorbedOrderIds ?? [];
        absorbedOrderIds.forEach((id) => claimedSourceIds.add(id));
        const primaryOrder = audit.primaryOrderId ? orderById.get(audit.primaryOrderId) : undefined;
        const sourceOrders = absorbedOrderIds
            .map((id) => orderById.get(id))
            .filter((order): order is NonNullable<typeof order> => Boolean(order));
        const candidateMovedItems = movedItems.filter((item) =>
            item.originOrderId !== null && absorbedOrderIds.includes(item.originOrderId)
        );
        const auditedTableIds = [
            ...(audit.destinationTableId ? [audit.destinationTableId] : []),
            ...(audit.sourceTableIds ?? [])
        ];
        const uniqueAuditedTableIds = [...new Set(auditedTableIds)];
        const orderBranchIds = new Set<number>();
        if (primaryOrder) orderBranchIds.add(primaryOrder.branchId);
        sourceOrders.forEach((order) => orderBranchIds.add(order.branchId));
        const orderBranchId = orderBranchIds.size === 1 ? [...orderBranchIds][0] : null;
        const branchIds = new Set<number>();
        if (primaryOrder) branchIds.add(primaryOrder.branchId);
        sourceOrders.forEach((order) => branchIds.add(order.branchId));
        for (const tableId of auditedTableIds) {
            const table = tableById.get(tableId);
            if (table) branchIds.add(table.branchId);
        }
        const resolvedBranchId = branchIds.size === 1 ? [...branchIds][0] : null;

        const checks = {
            auditShapeValid: Boolean(
                audit.details
                && audit.primaryOrderId
                && audit.destinationTableId
                && audit.sourceTableIds
                && audit.absorbedOrderIds
                && audit.movedItemIds
                && audit.absorbedOrderIds.length > 0
            ),
            hasAbsorbedOrders: absorbedOrderIds.length > 0 && sourceOrders.length > 0,
            auditEntityMatchesPrimary: audit.primaryOrderId !== null && audit.entityId === audit.primaryOrderId,
            primaryOrderPresent: Boolean(primaryOrder),
            allAbsorbedOrdersPresent: sourceOrders.length === absorbedOrderIds.length,
            allAuditTablesPresent: auditedTableIds.length > 0
                && uniqueAuditedTableIds.length === auditedTableIds.length
                && uniqueAuditedTableIds.every((id) => tableById.has(id)),
            primaryOrderTableMatchesAudit: Boolean(
                primaryOrder
                && audit.destinationTableId
                && primaryOrder.tableId === audit.destinationTableId
            ),
            sourceOrderTablesMatchAudit: sourceOrders.length > 0
                && audit.sourceTableIds !== null
                && sourceOrders.every((order) => order.tableId !== null)
                && sameIds(
                    sourceOrders.map((order) => order.tableId as number),
                    audit.sourceTableIds
                ),
            auditedTablesMatchOrderBranch: orderBranchId !== null
                && auditedTableIds.length > 0
                && auditedTableIds.every(
                    (id) => tableById.get(id)?.branchId === orderBranchId
                ),
            branchUnambiguous: resolvedBranchId !== null,
            absorbedLinksIntact: sourceOrders.length > 0 && sourceOrders.every((order) =>
                order.consolidatedIntoOrderId === audit.primaryOrderId
            ),
            absorbedRowsCancelled: sourceOrders.length > 0
                && sourceOrders.every((order) => order.status === 'CANCELLED'),
            absorbedFinancialStatusUnpaid: sourceOrders.length > 0 && sourceOrders.every(
                (order) => order.financialStatus === 'UNPAID'
            ),
            absorbedFinancialsZeroed: sourceOrders.length > 0 && sourceOrders.every((order) =>
                [
                    order.total,
                    order.discount,
                    order.tax,
                    order.tipAmount,
                    order.channelCommission,
                    order.channelMarkup
                ].every((value) => cents(value) === 0)
            ),
            absorbedCancellationMetadataIntact: sourceOrders.length > 0 && sourceOrders.every((order) =>
                order.cancelledAt !== null
                && order.closedAt !== null
                && order.cancelReason === `Consolidada en orden #${audit.primaryOrderId}`
            ),
            cancellationActorMatches: sourceOrders.length > 0
                && sourceOrders.every((order) => order.cancelledById === audit.userId),
            singleAuditPerAbsorbedOrder: absorbedOrderIds.length > 0
                && absorbedOrderIds.every((id) => auditCountBySource.get(id) === 1),
            movedItemsPresent: candidateMovedItems.length > 0
                && audit.movedItemIds !== null
                && audit.movedItemIds.length > 0,
            itemIdsMatchAudit: candidateMovedItems.length > 0
                && audit.movedItemIds !== null
                && sameIds(candidateMovedItems.map((item) => item.id), audit.movedItemIds),
            movedItemsStillOnPrimary: audit.primaryOrderId !== null
                && candidateMovedItems.length > 0
                && candidateMovedItems.every((item) => item.orderId === audit.primaryOrderId),
            noDurableSnapshot: absorbedOrderIds.length > 0
                && absorbedOrderIds.every((id) => !snapshotOrderIds.has(id))
        };
        const failedChecks = Object.entries(checks)
            .filter(([, passed]) => !passed)
            .map(([name]) => name);
        const classification: LegacyClassification = failedChecks.length === 0
            ? 'NOT_REVERSIBLE'
            : 'AMBIGUOUS';
        const reasons = classification === 'NOT_REVERSIBLE'
            ? ['ORIGINAL_ORDER_FINANCIALS_AND_STATUS_WERE_NOT_SNAPSHOTTED']
            : failedChecks;
        const evidence: LegacyEvidence = {
            source: 'LEGACY_AUDIT',
            auditLogId: audit.id,
            auditCreatedAt: audit.createdAt.toISOString(),
            auditUserId: audit.userId,
            primaryOrderId: audit.primaryOrderId,
            destinationTableId: audit.destinationTableId,
            sourceTableIds: audit.sourceTableIds ?? [],
            absorbedOrderIds,
            auditMovedItemIds: audit.movedItemIds ?? [],
            currentMovedItems: candidateMovedItems,
            orderStates: [primaryOrder, ...sourceOrders]
                .filter((order): order is NonNullable<typeof order> => Boolean(order))
                .map((order) => ({
                    ...order,
                    total: order.total.toString(),
                    discount: order.discount.toString(),
                    tax: order.tax.toString(),
                    tipAmount: order.tipAmount.toString(),
                    channelCommission: order.channelCommission.toString(),
                    channelMarkup: order.channelMarkup.toString(),
                    cancelledAt: order.cancelledAt?.toISOString() ?? null,
                    closedAt: order.closedAt?.toISOString() ?? null
                }))
                .sort((left, right) => left.id - right.id),
            checks
        };
        const candidateKey = sha256({ companyId, source: evidence.source, auditLogId: audit.id });
        const evidenceHash = sha256(evidence);
        const { history, latest: review, current: currentReview } = reviewState(
            candidateKey,
            evidenceHash
        );
        const candidate: LegacyConsolidationCandidate = {
            candidateKey,
            evidenceHash,
            classification,
            reversible: false,
            branchId: resolvedBranchId,
            primaryOrderId: audit.primaryOrderId,
            absorbedOrderIds,
            auditLogId: audit.id,
            reasons,
            evidence,
            reviewHistoryCount: history.length,
            currentEvidenceReviewed: Boolean(currentReview),
            review: review
                ? {
                    id: review.id,
                    revision: review.revision,
                    evidenceHash: review.evidenceHash,
                    classification: review.classification,
                    outcome: review.outcome,
                    note: review.note,
                    resolutionKey: review.resolutionKey,
                    reviewedById: review.reviewedById,
                    reviewedAt: review.reviewedAt,
                    evidenceChangedAfterReview: review.evidenceHash !== evidenceHash
                }
                : null
        };
        if (branchId === undefined || candidate.branchId === branchId) candidates.push(candidate);
    }

    const orphanGroups = new Map<number, typeof legacySources>();
    for (const source of legacySources) {
        if (claimedSourceIds.has(source.id) || source.consolidatedIntoOrderId === null) continue;
        const existing = orphanGroups.get(source.consolidatedIntoOrderId) ?? [];
        existing.push(source);
        orphanGroups.set(source.consolidatedIntoOrderId, existing);
    }
    for (const [primaryOrderId, sourceOrders] of orphanGroups) {
        const primaryOrder = orderById.get(primaryOrderId);
        const absorbedOrderIds = sourceOrders.map((order) => order.id).sort((a, b) => a - b);
        const candidateMovedItems = movedItems.filter((item) =>
            item.originOrderId !== null && absorbedOrderIds.includes(item.originOrderId)
        );
        const branchIds = new Set(sourceOrders.map((order) => order.branchId));
        if (primaryOrder) branchIds.add(primaryOrder.branchId);
        const resolvedBranchId = branchIds.size === 1 ? [...branchIds][0] : null;
        const checks = {
            auditPresent: false,
            primaryOrderPresent: Boolean(primaryOrder),
            branchUnambiguous: resolvedBranchId !== null,
            absorbedLinksIntact: sourceOrders.every((order) => order.consolidatedIntoOrderId === primaryOrderId),
            noDurableSnapshot: sourceOrders.every((order) => !snapshotOrderIds.has(order.id))
        };
        const evidence: LegacyEvidence = {
            source: 'ORPHAN_ORDER_LINKS',
            auditLogId: null,
            auditCreatedAt: null,
            auditUserId: null,
            primaryOrderId,
            destinationTableId: primaryOrder?.tableId ?? null,
            sourceTableIds: sourceOrders
                .map((order) => order.tableId)
                .filter((id): id is number => id !== null),
            absorbedOrderIds,
            auditMovedItemIds: [],
            currentMovedItems: candidateMovedItems,
            orderStates: [primaryOrder, ...sourceOrders]
                .filter((order): order is NonNullable<typeof order> => Boolean(order))
                .map((order) => ({
                    ...order,
                    total: order.total.toString(),
                    discount: order.discount.toString(),
                    tax: order.tax.toString(),
                    tipAmount: order.tipAmount.toString(),
                    channelCommission: order.channelCommission.toString(),
                    channelMarkup: order.channelMarkup.toString(),
                    cancelledAt: order.cancelledAt?.toISOString() ?? null,
                    closedAt: order.closedAt?.toISOString() ?? null
                }))
                .sort((left, right) => left.id - right.id),
            checks
        };
        const candidateKey = sha256({
            companyId,
            source: evidence.source,
            primaryOrderId,
            absorbedOrderIds
        });
        const evidenceHash = sha256(evidence);
        const { history, latest: review, current: currentReview } = reviewState(
            candidateKey,
            evidenceHash
        );
        const candidate: LegacyConsolidationCandidate = {
            candidateKey,
            evidenceHash,
            classification: 'AMBIGUOUS',
            reversible: false,
            branchId: resolvedBranchId,
            primaryOrderId,
            absorbedOrderIds,
            auditLogId: null,
            reasons: ['TABLE_CONSOLIDATE_AUDIT_MISSING'],
            evidence,
            reviewHistoryCount: history.length,
            currentEvidenceReviewed: Boolean(currentReview),
            review: review
                ? {
                    id: review.id,
                    revision: review.revision,
                    evidenceHash: review.evidenceHash,
                    classification: review.classification,
                    outcome: review.outcome,
                    note: review.note,
                    resolutionKey: review.resolutionKey,
                    reviewedById: review.reviewedById,
                    reviewedAt: review.reviewedAt,
                    evidenceChangedAfterReview: review.evidenceHash !== evidenceHash
                }
                : null
        };
        if (branchId === undefined || candidate.branchId === branchId) candidates.push(candidate);
    }

    return candidates.sort((left, right) => {
        const auditOrder = (left.auditLogId ?? Number.MAX_SAFE_INTEGER)
            - (right.auditLogId ?? Number.MAX_SAFE_INTEGER);
        return auditOrder || left.candidateKey.localeCompare(right.candidateKey);
    });
}

export class LegacyTableConsolidationReviewService {
    static async inventory(companyId: number, branchId?: number) {
        const candidates = await buildInventory(prisma, companyId, branchId);
        return {
            summary: {
                reversible: 0,
                notReversible: candidates.filter((candidate) => candidate.classification === 'NOT_REVERSIBLE').length,
                ambiguous: candidates.filter((candidate) => candidate.classification === 'AMBIGUOUS').length,
                reviewed: candidates.filter((candidate) => candidate.review !== null).length,
                evidenceChangedAfterReview: candidates.filter(
                    (candidate) => candidate.review?.evidenceChangedAfterReview
                ).length
            },
            candidates
        };
    }

    static async mark(
        companyId: number,
        actorId: number,
        branchId: number | undefined,
        candidateKeyValue: string,
        data: {
            expectedEvidenceHash: string;
            resolutionKey: string;
            outcome: LegacyOutcome;
            note: string;
        }
    ) {
        const candidateKey = trimText(candidateKeyValue, 64, 64, 'candidateKey');
        const expectedEvidenceHash = trimText(
            data.expectedEvidenceHash,
            64,
            64,
            'expectedEvidenceHash'
        );
        if (!/^[a-f0-9]{64}$/.test(candidateKey) || !/^[a-f0-9]{64}$/.test(expectedEvidenceHash)) {
            throw new Error('Las huellas de evidencia deben ser SHA-256 hexadecimales');
        }
        const resolutionKey = trimText(data.resolutionKey, 8, 191, 'resolutionKey');
        const note = trimText(data.note, 5, 1000, 'note');
        if (![
            'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL',
            'EXTERNAL_EVIDENCE_REQUIRED'
        ].includes(data.outcome)) {
            throw new Error('Resultado de revisión histórica no válido');
        }

        return prisma.$transaction(async (tx) => {
            const initial = (await buildInventory(tx, companyId, branchId))
                .find((candidate) => candidate.candidateKey === candidateKey);
            if (!initial) throw new Error('Candidato histórico no encontrado dentro del alcance autorizado');

            if (initial.auditLogId !== null) {
                await tx.$queryRaw`SELECT id FROM \`AuditLog\` WHERE id = ${initial.auditLogId} AND companyId = ${companyId} FOR UPDATE`;
            }
            const orderIds = [...new Set([
                ...(initial.primaryOrderId ? [initial.primaryOrderId] : []),
                ...initial.absorbedOrderIds
            ])].sort((left, right) => left - right);
            for (const orderId of orderIds) {
                await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            }
            const itemIds = initial.evidence.currentMovedItems
                .map((item) => item.id)
                .sort((left, right) => left - right);
            for (const itemId of itemIds) {
                await tx.$queryRaw`SELECT id FROM \`OrderItem\` WHERE id = ${itemId} FOR UPDATE`;
            }

            const existing = await tx.legacyTableConsolidationReview.findUnique({
                where: {
                    companyId_candidateKey_evidenceHash: {
                        companyId,
                        candidateKey,
                        evidenceHash: expectedEvidenceHash
                    }
                }
            });
            if (existing) {
                if (
                    existing.resolutionKey !== resolutionKey
                    || existing.evidenceHash !== expectedEvidenceHash
                    || existing.outcome !== data.outcome
                    || existing.note !== note
                ) {
                    throw new Error('El candidato histórico ya fue marcado con otra resolución');
                }
                return { idempotent: true, review: existing };
            }

            const current = (await buildInventory(tx, companyId, branchId))
                .find((candidate) => candidate.candidateKey === candidateKey);
            if (!current || current.evidenceHash !== expectedEvidenceHash) {
                throw new Error('La evidencia histórica cambió; vuelva a ejecutar el inventario antes de marcar');
            }
            const expectedOutcome: LegacyOutcome = current.classification === 'NOT_REVERSIBLE'
                ? 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL'
                : 'EXTERNAL_EVIDENCE_REQUIRED';
            if (data.outcome !== expectedOutcome) {
                throw new Error(
                    current.classification === 'NOT_REVERSIBLE'
                        ? 'Este caso sólo puede reconocerse como no reversible automáticamente'
                        : 'Este caso ambiguo requiere evidencia externa'
                );
            }
            const reusedResolution = await tx.legacyTableConsolidationReview.findFirst({
                where: { companyId, resolutionKey },
                select: { id: true }
            });
            if (reusedResolution) {
                throw new Error(`La clave de resolución ya fue usada por la revisión #${reusedResolution.id}`);
            }

            const review = await tx.legacyTableConsolidationReview.create({
                data: {
                    companyId,
                    branchId: current.branchId,
                    candidateKey,
                    evidenceHash: current.evidenceHash,
                    revision: current.reviewHistoryCount + 1,
                    classification: current.classification,
                    outcome: data.outcome,
                    note,
                    resolutionKey,
                    evidenceSnapshot: current.evidence as unknown as Prisma.InputJsonValue,
                    reviewedById: actorId
                }
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'LegacyTableConsolidationReview',
                    entityId: review.id,
                    action: 'LEGACY_TABLE_CONSOLIDATION_REVIEW',
                    userId: actorId,
                    details: {
                        branchId: current.branchId,
                        candidateKey,
                        evidenceHash: current.evidenceHash,
                        revision: review.revision,
                        classification: current.classification,
                        outcome: data.outcome,
                        resolutionKey,
                        note,
                        primaryOrderId: current.primaryOrderId,
                        absorbedOrderIds: current.absorbedOrderIds,
                        auditLogId: current.auditLogId
                    }
                }
            });
            return { idempotent: false, review };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        });
    }
}
