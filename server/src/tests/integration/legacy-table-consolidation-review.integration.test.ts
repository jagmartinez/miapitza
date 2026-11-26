import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';

describe('legacy table consolidation review flow', () => {
    const adminUsername = 'legacy_table_review_admin';
    const cashierUsername = 'legacy_table_review_cashier';
    const password = 'LegacyReview123!';
    let companyId: number;
    let branchAId: number;
    let branchBId: number;
    let adminRoleId: number;
    let cashierRoleId: number;
    let adminUserId: number;
    let cashierUserId: number;
    let categoryId: number;
    let menuItemId: number;
    let adminToken: string;
    let cashierToken: string;
    let firstStrongACandidate: {
        candidateKey: string;
        evidenceHash: string;
        classification: string;
    };
    const tableIds: number[] = [];
    const orderIds: number[] = [];
    const itemIds: number[] = [];
    const auditIds: number[] = [];
    let strongA: Awaited<ReturnType<typeof createLegacyCandidate>>;
    let orphanA: Awaited<ReturnType<typeof createLegacyCandidate>>;
    let mutableA: Awaited<ReturnType<typeof createLegacyCandidate>>;
    let strongB: Awaited<ReturnType<typeof createLegacyCandidate>>;

    async function createLegacyCandidate(input: {
        branchId: number;
        suffix: string;
        withAudit: boolean;
    }) {
        const [destination, source] = await Promise.all([
            prisma.table.create({
                data: {
                    companyId,
                    branchId: input.branchId,
                    number: `${input.suffix}-D`,
                    capacity: 4,
                    status: 'OCCUPIED'
                }
            }),
            prisma.table.create({
                data: {
                    companyId,
                    branchId: input.branchId,
                    number: `${input.suffix}-S`,
                    capacity: 4,
                    status: 'AVAILABLE'
                }
            })
        ]);
        tableIds.push(destination.id, source.id);
        const primary = await prisma.order.create({
            data: {
                companyId,
                branchId: input.branchId,
                tableId: destination.id,
                userId: adminUserId,
                status: 'OPEN',
                financialStatus: 'UNPAID',
                total: 80
            }
        });
        const sourceOrder = await prisma.order.create({
            data: {
                companyId,
                branchId: input.branchId,
                tableId: source.id,
                userId: adminUserId,
                status: 'CANCELLED',
                financialStatus: 'UNPAID',
                total: 0,
                discount: 0,
                tax: 0,
                tipAmount: 0,
                channelCommission: 0,
                channelMarkup: 0,
                consolidatedIntoOrderId: primary.id,
                cancelledById: adminUserId,
                cancelledAt: new Date('2026-07-20T12:00:00.000Z'),
                closedAt: new Date('2026-07-20T12:00:00.000Z'),
                cancelReason: `Consolidada en orden #${primary.id}`
            }
        });
        orderIds.push(primary.id, sourceOrder.id);
        const movedItem = await prisma.orderItem.create({
            data: {
                orderId: primary.id,
                menuItemId,
                quantity: 1,
                price: 30,
                subtotal: 30,
                originOrderId: sourceOrder.id,
                originTableId: source.id
            }
        });
        itemIds.push(movedItem.id);
        let auditLogId: number | null = null;
        if (input.withAudit) {
            const audit = await prisma.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: primary.id,
                    action: 'TABLE_CONSOLIDATE',
                    userId: adminUserId,
                    details: {
                        destinationTableId: destination.id,
                        sourceTableIds: [source.id],
                        primaryOrderId: primary.id,
                        absorbedOrderIds: [sourceOrder.id],
                        movedItemIds: [movedItem.id],
                        reason: 'Registro histórico de prueba'
                    }
                }
            });
            auditLogId = audit.id;
            auditIds.push(audit.id);
        }
        return {
            branchId: input.branchId,
            primaryOrderId: primary.id,
            sourceOrderId: sourceOrder.id,
            itemId: movedItem.id,
            auditLogId
        };
    }

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: 'Legacy Table Review Integration', active: true }
        });
        companyId = company.id;
        const [branchA, branchB] = await Promise.all([
            prisma.branch.create({
                data: { companyId, name: 'Legacy Review A', code: `LRA-${companyId}` }
            }),
            prisma.branch.create({
                data: { companyId, name: 'Legacy Review B', code: `LRB-${companyId}` }
            })
        ]);
        branchAId = branchA.id;
        branchBId = branchB.id;
        const permission = await prisma.permission.upsert({
            where: { name: 'tables.consolidate' },
            update: {},
            create: { name: 'tables.consolidate', description: 'Consolidar cuentas de mesas' }
        });
        const [adminRole, cashierRole] = await Promise.all([
            prisma.role.create({
                data: {
                    companyId,
                    name: 'ADMIN',
                    description: 'Legacy review integration admin',
                    permissions: { connect: { id: permission.id } }
                }
            }),
            prisma.role.create({
                data: {
                    companyId,
                    name: 'LEGACY_REVIEW_CASHIER',
                    description: 'Branch-scoped legacy reviewer',
                    permissions: { connect: { id: permission.id } }
                }
            })
        ]);
        adminRoleId = adminRole.id;
        cashierRoleId = cashierRole.id;
        const passwordHash = await bcrypt.hash(password, 10);
        const [admin, cashier] = await Promise.all([
            prisma.user.create({
                data: {
                    companyId,
                    branchId: branchAId,
                    roleId: adminRoleId,
                    name: 'Legacy Review Admin',
                    email: `legacy-admin-${companyId}@example.com`,
                    username: adminUsername,
                    password: passwordHash,
                    status: 'ACTIVE',
                    mustChangePassword: false,
                    passwordChangedAt: new Date()
                }
            }),
            prisma.user.create({
                data: {
                    companyId,
                    branchId: branchBId,
                    roleId: cashierRoleId,
                    name: 'Legacy Review Cashier',
                    email: `legacy-cashier-${companyId}@example.com`,
                    username: cashierUsername,
                    password: passwordHash,
                    status: 'ACTIVE',
                    mustChangePassword: false,
                    passwordChangedAt: new Date()
                }
            })
        ]);
        adminUserId = admin.id;
        cashierUserId = cashier.id;
        const category = await prisma.category.create({
            data: { companyId, name: 'Legacy Review Menu' }
        });
        categoryId = category.id;
        const menuItem = await prisma.menuItem.create({
            data: {
                companyId,
                branchId: branchAId,
                categoryId,
                name: 'Legacy review item',
                price: 30,
                type: 'DIRECT'
            }
        });
        menuItemId = menuItem.id;

        strongA = await createLegacyCandidate({ branchId: branchAId, suffix: 'A1', withAudit: true });
        orphanA = await createLegacyCandidate({ branchId: branchAId, suffix: 'A2', withAudit: false });
        mutableA = await createLegacyCandidate({ branchId: branchAId, suffix: 'A3', withAudit: true });
        strongB = await createLegacyCandidate({ branchId: branchBId, suffix: 'B1', withAudit: true });

        const [adminLogin, cashierLogin] = await Promise.all([
            request(app).post('/api/auth/login').send({ username: adminUsername, password }),
            request(app).post('/api/auth/login').send({ username: cashierUsername, password })
        ]);
        expect(adminLogin.status).toBe(200);
        expect(cashierLogin.status).toBe(200);
        adminToken = adminLogin.body.data.token;
        cashierToken = cashierLogin.body.data.token;
    });

    afterAll(async () => {
        await prisma.legacyTableConsolidationReview.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.orderItem.deleteMany({ where: { id: { in: itemIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.table.deleteMany({ where: { id: { in: tableIds } } });
        await prisma.menuItem.delete({ where: { id: menuItemId } });
        await prisma.category.delete({ where: { id: categoryId } });
        await prisma.userSession.deleteMany({
            where: { userId: { in: [adminUserId, cashierUserId] } }
        });
        await prisma.user.deleteMany({ where: { id: { in: [adminUserId, cashierUserId] } } });
        await prisma.role.deleteMany({ where: { id: { in: [adminRoleId, cashierRoleId] } } });
        await prisma.branch.deleteMany({ where: { id: { in: [branchAId, branchBId] } } });
        await prisma.company.delete({ where: { id: companyId } });
        await prisma.$disconnect();
    });

    async function inventory(token: string, branchId?: number) {
        const call = request(app)
            .get('/api/tables/consolidations/legacy-inventory')
            .set('Authorization', `Bearer ${token}`);
        return branchId ? call.query({ branchId }) : call;
    }

    function mark(
        token: string,
        candidate: { candidateKey: string; evidenceHash: string; classification: string },
        resolutionKey: string
    ) {
        return request(app)
            .post(`/api/tables/consolidations/legacy-inventory/${candidate.candidateKey}/mark`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                expectedEvidenceHash: candidate.evidenceHash,
                resolutionKey,
                outcome: candidate.classification === 'NOT_REVERSIBLE'
                    ? 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL'
                    : 'EXTERNAL_EVIDENCE_REQUIRED',
                note: 'Revisión administrativa sin reconstruir importes ni estados'
            });
    }

    it('classifies exact legacy evidence and enforces tenant branch scope', async () => {
        const adminInventory = await inventory(adminToken);
        expect(adminInventory.status).toBe(200);
        expect(adminInventory.body.data.summary).toEqual(expect.objectContaining({
            reversible: 0,
            notReversible: 3,
            ambiguous: 1,
            reviewed: 0
        }));
        expect(adminInventory.body.data.candidates).toHaveLength(4);
        expect(adminInventory.body.data.candidates.find(
            (candidate: { auditLogId: number | null }) => candidate.auditLogId === strongA.auditLogId
        )).toEqual(expect.objectContaining({
            classification: 'NOT_REVERSIBLE',
            reversible: false,
            branchId: branchAId
        }));
        expect(adminInventory.body.data.candidates.find(
            (candidate: { primaryOrderId: number }) => candidate.primaryOrderId === orphanA.primaryOrderId
        )).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            reasons: ['TABLE_CONSOLIDATE_AUDIT_MISSING']
        }));

        const cashierInventory = await inventory(cashierToken, branchAId);
        expect(cashierInventory.status).toBe(200);
        expect(cashierInventory.body.data.candidates).toHaveLength(1);
        expect(cashierInventory.body.data.candidates[0].primaryOrderId)
            .toBe(strongB.primaryOrderId);
    });

    it('marks a confirmed case idempotently without changing orders or items', async () => {
        const loaded = await inventory(adminToken, branchAId);
        const candidate = loaded.body.data.candidates.find(
            (entry: { auditLogId: number | null }) => entry.auditLogId === strongA.auditLogId
        );
        firstStrongACandidate = candidate;
        const [orderBefore, itemBefore] = await Promise.all([
            prisma.order.findUnique({ where: { id: strongA.sourceOrderId } }),
            prisma.orderItem.findUnique({ where: { id: strongA.itemId } })
        ]);

        const marked = await mark(adminToken, candidate, 'legacy-review-strong-a');
        expect(marked.status).toBe(200);
        expect(marked.body.data.idempotent).toBe(false);
        const replay = await mark(adminToken, candidate, 'legacy-review-strong-a');
        expect(replay.status).toBe(200);
        expect(replay.body.data.idempotent).toBe(true);

        const [orderAfter, itemAfter, reviewCount, auditCount] = await Promise.all([
            prisma.order.findUnique({ where: { id: strongA.sourceOrderId } }),
            prisma.orderItem.findUnique({ where: { id: strongA.itemId } }),
            prisma.legacyTableConsolidationReview.count({
                where: { companyId, candidateKey: candidate.candidateKey }
            }),
            prisma.auditLog.count({
                where: {
                    companyId,
                    entityType: 'LegacyTableConsolidationReview',
                    action: 'LEGACY_TABLE_CONSOLIDATION_REVIEW',
                    details: { path: '$.candidateKey', equals: candidate.candidateKey }
                }
            })
        ]);
        expect(orderAfter).toEqual(orderBefore);
        expect(itemAfter).toEqual(itemBefore);
        expect(reviewCount).toBe(1);
        expect(auditCount).toBe(1);

        const branchDenied = await mark(cashierToken, candidate, 'legacy-review-branch-denied');
        expect(branchDenied.status).toBe(409);
    });

    it('preserves the prior review and versions a new disposition for changed evidence', async () => {
        await prisma.order.update({
            where: { id: strongA.sourceOrderId },
            data: { cancelReason: 'Evidencia modificada después de la primera revisión' }
        });
        const loaded = await inventory(adminToken, branchAId);
        const currentCandidate = loaded.body.data.candidates.find(
            (entry: { auditLogId: number | null }) => entry.auditLogId === strongA.auditLogId
        );
        expect(currentCandidate).toEqual(expect.objectContaining({
            candidateKey: firstStrongACandidate.candidateKey,
            classification: 'AMBIGUOUS',
            reviewHistoryCount: 1,
            currentEvidenceReviewed: false,
            review: expect.objectContaining({
                revision: 1,
                evidenceChangedAfterReview: true
            })
        }));
        expect(currentCandidate.evidenceHash).not.toBe(firstStrongACandidate.evidenceHash);

        const oldReplay = await mark(
            adminToken,
            firstStrongACandidate,
            'legacy-review-strong-a'
        );
        expect(oldReplay.status).toBe(200);
        expect(oldReplay.body.data.idempotent).toBe(true);

        const sourceBeforeReview = await prisma.order.findUnique({
            where: { id: strongA.sourceOrderId }
        });
        const results = await Promise.all([
            mark(adminToken, currentCandidate, 'legacy-review-strong-a-v2'),
            mark(adminToken, currentCandidate, 'legacy-review-strong-a-v2')
        ]);
        expect(results.map((response) => response.status)).toEqual([200, 200]);
        expect(results.map((response) => response.body.data.idempotent).sort())
            .toEqual([false, true]);

        const history = await prisma.legacyTableConsolidationReview.findMany({
            where: { companyId, candidateKey: currentCandidate.candidateKey },
            orderBy: { revision: 'asc' }
        });
        expect(history).toHaveLength(2);
        expect(history.map((review) => review.revision)).toEqual([1, 2]);
        expect(history.map((review) => review.evidenceHash))
            .toEqual([firstStrongACandidate.evidenceHash, currentCandidate.evidenceHash]);
        expect(history.map((review) => review.outcome)).toEqual([
            'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL',
            'EXTERNAL_EVIDENCE_REQUIRED'
        ]);
        expect(history.map((review) => review.resolutionKey)).toEqual([
            'legacy-review-strong-a',
            'legacy-review-strong-a-v2'
        ]);
        expect(await prisma.order.findUnique({ where: { id: strongA.sourceOrderId } }))
            .toEqual(sourceBeforeReview);
    });

    it('rejects reused keys and evidence that changed after inventory', async () => {
        const loaded = await inventory(adminToken, branchAId);
        const mutableCandidate = loaded.body.data.candidates.find(
            (entry: { auditLogId: number | null }) => entry.auditLogId === mutableA.auditLogId
        );
        const duplicateKey = await mark(adminToken, mutableCandidate, 'legacy-review-strong-a');
        expect(duplicateKey.status).toBe(409);

        await prisma.order.update({
            where: { id: mutableA.sourceOrderId },
            data: { cancelReason: 'Cambio posterior que invalida la evidencia cargada' }
        });
        const staleEvidence = await mark(adminToken, mutableCandidate, 'legacy-review-mutated-a');
        expect(staleEvidence.status).toBe(409);
        expect(await prisma.legacyTableConsolidationReview.count({
            where: { companyId, candidateKey: mutableCandidate.candidateKey }
        })).toBe(0);
    });

    it('serializes concurrent marking into one write and one idempotent replay', async () => {
        const loaded = await inventory(adminToken, branchAId);
        const orphanCandidate = loaded.body.data.candidates.find(
            (entry: { primaryOrderId: number }) => entry.primaryOrderId === orphanA.primaryOrderId
        );
        const results = await Promise.all([
            mark(adminToken, orphanCandidate, 'legacy-review-orphan-race'),
            mark(adminToken, orphanCandidate, 'legacy-review-orphan-race')
        ]);

        expect(results.map((response) => response.status)).toEqual([200, 200]);
        expect(results.map((response) => response.body.data.idempotent).sort())
            .toEqual([false, true]);
        const review = await prisma.legacyTableConsolidationReview.findFirst({
            where: { companyId, candidateKey: orphanCandidate.candidateKey }
        });
        expect(review).toEqual(expect.objectContaining({
            classification: 'AMBIGUOUS',
            outcome: 'EXTERNAL_EVIDENCE_REQUIRED',
            resolutionKey: 'legacy-review-orphan-race'
        }));
        const [reviewCount, auditCount] = await Promise.all([
            prisma.legacyTableConsolidationReview.count({
                where: {
                    companyId,
                    candidateKey: orphanCandidate.candidateKey,
                    evidenceHash: orphanCandidate.evidenceHash
                }
            }),
            prisma.auditLog.count({
                where: {
                    companyId,
                    entityType: 'LegacyTableConsolidationReview',
                    entityId: review!.id,
                    action: 'LEGACY_TABLE_CONSOLIDATION_REVIEW'
                }
            })
        ]);
        expect(reviewCount).toBe(1);
        expect(auditCount).toBe(1);
    });

    it('rolls back the review when its audit insert fails', async () => {
        const loaded = await inventory(adminToken, branchBId);
        const candidate = loaded.body.data.candidates.find(
            (entry: { primaryOrderId: number }) => entry.primaryOrderId === strongB.primaryOrderId
        );
        const sourceBefore = await prisma.order.findUnique({
            where: { id: strongB.sourceOrderId }
        });
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error('DATABASE_URL is required by the migrated integration harness');
        const directDatabase = await mysql.createConnection({ uri: databaseUrl });
        try {
            await directDatabase.query(
                "CREATE TRIGGER `LegacyReviewAuditFailure` BEFORE INSERT ON `AuditLog` FOR EACH ROW SET NEW.`action` = IF(NEW.`action` = 'LEGACY_TABLE_CONSOLIDATION_REVIEW', NULL, NEW.`action`)"
            );
            try {
                const rejected = await mark(adminToken, candidate, 'legacy-review-audit-failure');
                expect(rejected.status).toBe(409);
            } finally {
                await directDatabase.query('DROP TRIGGER IF EXISTS `LegacyReviewAuditFailure`');
            }
        } finally {
            await directDatabase.end();
        }

        expect(await prisma.legacyTableConsolidationReview.count({
            where: { companyId, candidateKey: candidate.candidateKey }
        })).toBe(0);
        expect(await prisma.order.findUnique({ where: { id: strongB.sourceOrderId } }))
            .toEqual(sourceBefore);
    });
});
