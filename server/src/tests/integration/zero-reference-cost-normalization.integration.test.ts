import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import prisma from '../../utils/prisma';
import { runZeroCostNormalization } from '../../scripts/normalize-zero-reference-costs';

describe('Zero reference cost normalization (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const reports = [
        path.join(os.tmpdir(), `zero-cost-${suffix}-dry-run.json`),
        path.join(os.tmpdir(), `zero-cost-${suffix}-apply.json`),
        path.join(os.tmpdir(), `zero-cost-${suffix}-replay.json`),
    ];
    let companyId = 0;
    let actorUserId = 0;
    let roleId = 0;
    let zeroInactiveId = 0;
    let zeroWithAverageId = 0;
    let positiveId = 0;

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: `Zero cost integration ${suffix}` },
        });
        companyId = company.id;
        const role = await prisma.role.create({
            data: { companyId, name: 'ADMIN', description: 'Integration actor' },
        });
        roleId = role.id;
        const actor = await prisma.user.create({
            data: {
                companyId,
                name: `Zero Cost Actor ${suffix}`,
                email: `zero.cost.${suffix}@example.test`,
                username: `zero_cost_${suffix}`,
                password: 'integration-test-not-a-real-credential',
                roleId,
                status: 'ACTIVE',
            },
        });
        actorUserId = actor.id;
        const [zeroInactive, zeroWithAverage, positive] = await Promise.all([
            prisma.product.create({
                data: {
                    companyId,
                    name: `Inactive zero ${suffix}`,
                    sku: `ZERO-INACTIVE-${suffix}`,
                    unit: 'unit',
                    cost: 0,
                    referenceCostKnown: false,
                    active: false,
                },
            }),
            prisma.product.create({
                data: {
                    companyId,
                    name: `Zero with average ${suffix}`,
                    sku: `ZERO-AVERAGE-${suffix}`,
                    unit: 'unit',
                    cost: 0,
                    referenceCostKnown: false,
                    currentAverageCost: 2.345678,
                    averageCostKnown: true,
                    lastPurchaseCost: 3.456789,
                    lastPurchaseCostKnown: true,
                    active: true,
                },
            }),
            prisma.product.create({
                data: {
                    companyId,
                    name: `Positive reference ${suffix}`,
                    sku: `POSITIVE-${suffix}`,
                    unit: 'unit',
                    cost: 4,
                    referenceCostKnown: true,
                    active: true,
                },
            }),
        ]);
        zeroInactiveId = zeroInactive.id;
        zeroWithAverageId = zeroWithAverage.id;
        positiveId = positive.id;
    });

    afterAll(async () => {
        delete process.env.ALLOW_ZERO_REFERENCE_COST_NORMALIZATION;
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        if (roleId) await prisma.role.delete({ where: { id: roleId } });
        if (companyId) await prisma.company.delete({ where: { id: companyId } });
        await Promise.all(reports.map((report) => fs.unlink(report).catch(() => undefined)));
    });

    it('normalizes exactly zero references, preserves transactional facts and is idempotent', async () => {
        const dryRun = await runZeroCostNormalization({
            companyId,
            reportFile: reports[0],
            apply: false,
        });
        expect(dryRun.applied).toBe(false);
        expect(dryRun.plannedCount).toBe(2);
        expect(await prisma.product.count({ where: { companyId, cost: 0 } })).toBe(2);

        process.env.ALLOW_ZERO_REFERENCE_COST_NORMALIZATION = '1';
        const applied = await runZeroCostNormalization({
            companyId,
            reportFile: reports[1],
            apply: true,
            actorUserId,
            confirmCompany: `Zero cost integration ${suffix}`,
        });
        expect(applied.applied).toBe(true);
        if (!('result' in applied) || !('idempotency' in applied)) {
            throw new Error('Expected an applied normalization result.');
        }
        expect(applied.result).toEqual({ updated: 2, auditRows: 2, remainingZero: 0 });
        expect(applied.idempotency.secondPassPlannedCount).toBe(0);

        const products = await prisma.product.findMany({
            where: { id: { in: [zeroInactiveId, zeroWithAverageId, positiveId] } },
            select: {
                id: true,
                cost: true,
                referenceCostKnown: true,
                currentAverageCost: true,
                averageCostKnown: true,
                lastPurchaseCost: true,
                lastPurchaseCostKnown: true,
            },
            orderBy: { id: 'asc' },
        });
        const inactive = products.find((product) => product.id === zeroInactiveId)!;
        const averaged = products.find((product) => product.id === zeroWithAverageId)!;
        const positive = products.find((product) => product.id === positiveId)!;
        expect(Number(inactive.cost)).toBe(1);
        expect(inactive.referenceCostKnown).toBe(true);
        expect(Number(averaged.cost)).toBe(1);
        expect(averaged.referenceCostKnown).toBe(true);
        expect(Number(averaged.currentAverageCost)).toBeCloseTo(2.345678, 6);
        expect(averaged.averageCostKnown).toBe(true);
        expect(Number(averaged.lastPurchaseCost)).toBeCloseTo(3.456789, 6);
        expect(averaged.lastPurchaseCostKnown).toBe(true);
        expect(Number(positive.cost)).toBe(4);
        expect(positive.referenceCostKnown).toBe(true);
        expect(await prisma.auditLog.count({
            where: {
                companyId,
                entityType: 'Product',
                entityId: { in: [zeroInactiveId, zeroWithAverageId] },
                action: 'UPDATE',
                userId: actorUserId,
            },
        })).toBe(2);

        const replay = await runZeroCostNormalization({
            companyId,
            reportFile: reports[2],
            apply: true,
            actorUserId,
            confirmCompany: `Zero cost integration ${suffix}`,
        });
        if (!('result' in replay)) throw new Error('Expected an applied replay result.');
        expect(replay.result).toEqual({ updated: 0, auditRows: 0, remainingZero: 0 });
        expect(await prisma.auditLog.count({ where: { companyId } })).toBe(2);

        const applyReport = JSON.parse(await fs.readFile(reports[1], 'utf8')) as {
            status: string;
            applied: boolean;
        };
        expect(applyReport).toEqual(expect.objectContaining({
            status: 'APPLIED_AND_VERIFIED',
            applied: true,
        }));
    });
});
