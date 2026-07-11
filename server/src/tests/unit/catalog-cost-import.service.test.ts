import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it, jest } from '@jest/globals';

import {
    CatalogCostImportService,
    CatalogCostMap,
    parseCatalogCostMap
} from '../../services/catalog-cost-import.service';

const policy: CatalogCostMap['policy'] = {
    sourceSelection: 'COMPLETE_COST_SHEET_THEN_COMPLETE_PURCHASE_FALLBACK',
    evaluatedPriceTreatment: 'USE_AS_EVALUATED',
    surcharge15Treatment: 'ALREADY_INCLUDED_WHEN_FORMULA_CONTAINS_1_15',
    updateField: 'cost',
    preserveCurrentAverageCost: true,
    preserveLastPurchaseCost: true,
    createPurchases: false,
    createStock: false,
    createInventoryMovements: false,
    createCostHistory: false
};

describe('recetas-menu.cost-map contract', () => {
    it('parses the generated source map with unique APPLY targets', async () => {
        const file = path.resolve(__dirname, '../../../prisma/data/recetas-menu.cost-map.json');
        const parsed = parseCatalogCostMap(JSON.parse(await readFile(file, 'utf8')));

        expect(parsed.issues.filter((entry) => entry.severity === 'ERROR')).toEqual([]);
        expect(parsed.map).not.toBeNull();
        expect(parsed.map?.entries).toHaveLength(277);

        const applySkus = parsed.map!.entries
            .filter((entry) => entry.resolution.decision === 'APPLY')
            .map((entry) => entry.target.sku);
        expect(new Set(applySkus).size).toBe(applySkus.length);
    });

    it('uses an evaluated *1.15 source price exactly once in dry-run', async () => {
        const map: CatalogCostMap = {
            schemaVersion: 1,
            source: {
                file: 'Recetas Menu.xlsx',
                sha256: 'a'.repeat(64),
                generatedAt: '2026-07-10T00:00:00.000Z',
                catalogSnapshotAt: '2026-07-10T00:00:00.000Z'
            },
            policy,
            entries: [{
                id: 'cost:1',
                source: {
                    sheet: 'Costo de insumos', row: 1, asOfDate: '2026-06-21', priority: 'PRIMARY',
                    name: 'Prueba', presentation: 'bolsa', unit: 'g', contentQuantity: 100,
                    evaluatedPrice: 115, priceFormula: '=100*1.15'
                },
                target: {
                    mode: 'CREATE', sku: 'CCI-TEST', catalogName: 'Prueba', baseUnit: 'g',
                    category: 'Misceláneo', productType: 'INGREDIENT', storageType: 'NON_PERISHABLE',
                    matchEvidence: 'DERIVED', catalogRole: 'PURCHASED_INPUT'
                },
                resolution: { decision: 'APPLY', blockers: [], rationale: 'Prueba.' },
                calculation: {
                    normalizedSourceName: 'prueba', normalizedSourceUnit: 'g',
                    surcharge15Detected: true, sourceUnitCost: 1.15, expectedBaseUnitCost: 1.15
                },
                notes: []
            }],
            productionCoverage: []
        };
        const db = {
            company: { findFirst: jest.fn(async () => ({ id: 1, name: 'Test' })) },
            user: { findMany: jest.fn(async () => []) },
            product: { findMany: jest.fn(async () => []) },
            unitOfMeasure: {
                findMany: jest.fn(async () => [{
                    id: 9, abbreviation: 'g', measurementType: 'MASS', systemFactor: 1, active: true
                }])
            },
            category: { findMany: jest.fn(async () => [{ id: 2, name: 'Misceláneo', active: true }]) }
        };

        const report = await CatalogCostImportService.plan(
            map,
            { companyId: 1, dryRun: true, allowPartial: false },
            db as never
        );

        expect(report.valid).toBe(true);
        expect(report.actions).toHaveLength(1);
        expect(report.actions[0].newReferenceCost).toBe(1.15);
        expect(report.actions[0].currentAverageCost).toBe(0);
        expect(report.actions[0].lastPurchaseCost).toBe(0);
    });
});
