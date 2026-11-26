import { afterEach, describe, expect, it } from '@jest/globals';

import {
    collectZeroCostPlan,
    parseArgs,
    validateApplyGuards,
} from '../../scripts/normalize-zero-reference-costs';

afterEach(() => {
    delete process.env.ALLOW_ZERO_REFERENCE_COST_NORMALIZATION;
    delete process.env.CONFIRM_ZERO_COST_COMPANY;
});

describe('normalize-zero-reference-costs safety contract', () => {
    it('defaults to dry-run and requires a tenant and a new report path', () => {
        const options = parseArgs([
            '--company-id', '1',
            '--report', './zero-cost-dry-run.json',
        ]);

        expect(options).toEqual(expect.objectContaining({
            companyId: 1,
            apply: false,
        }));
        expect(options.reportFile).toMatch(/zero-cost-dry-run\.json$/);
    });

    it('rejects ambiguous modes, unknown flags and apply without actor', () => {
        expect(() => parseArgs([
            '--company-id', '1', '--report', './x.json', '--apply', '--dry-run',
        ])).toThrow(/mutuamente excluyentes/i);
        expect(() => parseArgs([
            '--company-id', '1', '--report', './x.json', '--force',
        ])).toThrow(/desconocida/i);
        expect(() => parseArgs([
            '--company-id', '1', '--report', './x.json', '--apply',
        ])).toThrow(/actor-user-id/i);
    });

    it('selects only exact zero reference costs and serializes preserved facts', async () => {
        const findMany = async () => [{
            id: 7,
            companyId: 1,
            name: 'Miel',
            sku: 'ING-007',
            type: 'INGREDIENT',
            active: true,
            cost: { toFixed: () => '0' },
            referenceCostKnown: false,
            currentAverageCost: { toFixed: () => '12.3456' },
            averageCostKnown: true,
            lastPurchaseCost: { toFixed: () => '13.5' },
            lastPurchaseCostKnown: true,
            updatedAt: new Date('2026-07-23T12:00:00.000Z'),
        }];
        const db = { product: { findMany } };

        const plan = await collectZeroCostPlan(db as never, 1);

        expect(plan).toEqual([expect.objectContaining({
            id: 7,
            referenceCostBefore: '0',
            currentAverageCostPreserved: '12.3456',
            lastPurchaseCostPreserved: '13.5',
        })]);
    });

    it('requires both the explicit guard and exact company confirmation', () => {
        const options = {
            companyId: 1,
            reportFile: 'x.json',
            apply: true,
            actorUserId: 9,
            confirmCompany: 'La Mia Pitza',
        };

        expect(() => validateApplyGuards(options, 'La Mia Pitza')).toThrow(/ALLOW_ZERO/i);
        process.env.ALLOW_ZERO_REFERENCE_COST_NORMALIZATION = '1';
        expect(() => validateApplyGuards(
            { ...options, confirmCompany: 'Otra' },
            'La Mia Pitza',
        )).toThrow(/confirmación inválida/i);
        expect(validateApplyGuards(options, 'La Mia Pitza')).toBe(9);
    });
});
