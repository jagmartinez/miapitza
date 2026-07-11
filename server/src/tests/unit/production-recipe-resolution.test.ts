import { readFile } from 'fs/promises';
import path from 'path';

import type { NormalizedMenuRecipeDocument } from '../../services/menu-recipe-import.service';
import { parseNormalizedMenuRecipes } from '../../services/menu-recipe-import.service';
import type { NormalizedProductionRecipe } from '../../services/production-recipe-import.service';
import {
    detectProductionCycles,
    prepareProductionRecipes,
    ProductionResolutionMap
} from '../../scripts/prepare-production-recipes';

const dataDir = path.resolve(process.cwd(), 'prisma/data');

async function loadProductionFixture() {
    const [normalizedRaw, mapRaw] = await Promise.all([
        readFile(path.join(dataDir, 'recetas-menu.normalized.json'), 'utf8'),
        readFile(path.join(dataDir, 'recetas-menu.production-map.json'), 'utf8')
    ]);
    const parsed = parseNormalizedMenuRecipes(JSON.parse(normalizedRaw), { allowReviewRequired: true });
    if (!parsed.document) throw new Error('Fixture normalizado inválido.');
    return {
        document: parsed.document,
        map: JSON.parse(mapRaw) as ProductionResolutionMap
    };
}

function simpleDocument(): NormalizedMenuRecipeDocument {
    return {
        schemaVersion: 1,
        source: { file: 'source.xlsx', sha256: 'source-sha' },
        recipes: [],
        reviewRequired: [],
        productionRecipes: [{
            sourceKey: 'Produccion!A1',
            sourceRow: 1,
            status: 'DRAFT',
            output: { name: 'Salida fuente', sourceName: 'Salida fuente', productSku: 'OLD-OUT' },
            yield: { quantity: 10, unit: 'g' },
            components: [{
                name: 'Componente fuente',
                sourceName: 'Componente fuente',
                productSku: 'OLD-CMP',
                quantity: 2.5,
                unit: 'g',
                sourceRow: 2
            }]
        }]
    };
}

function simpleMap(): ProductionResolutionMap {
    return {
        schemaVersion: 1,
        source: { file: 'source.xlsx', sha256: 'source-sha', normalizedContract: 'source.json' },
        status: 'READY',
        policies: {
            initialRecipeStatus: 'DRAFT',
            applyRequiresAllRecipesReady: true,
            blockedMappingsAreNeverApplied: true,
            crossDimensionConversionsRequireBusinessEvidence: true,
            inferredYieldsRequireConfirmation: true
        },
        recipes: [{
            sourceKey: 'Produccion!A1',
            output: {
                status: 'RESOLVED',
                mapping: { status: 'RESOLVED', productSku: 'NEW-OUT', catalogName: 'Salida catálogo' },
                reasonCodes: [],
                evidence: ['SKU aprobado.'],
                decisionRequired: null,
                alternatives: []
            },
            yield: {
                status: 'RESOLVED',
                quantity: 10,
                unit: 'g',
                reasonCodes: [],
                evidence: ['Rendimiento declarado.'],
                decisionRequired: null
            },
            components: [{
                sourceRow: 2,
                sourceName: 'Componente fuente',
                quantity: 2.5,
                unit: 'g',
                status: 'RESOLVED',
                mapping: { status: 'RESOLVED', productSku: 'NEW-CMP', catalogName: 'Componente catálogo' },
                unitResolution: { status: 'RESOLVED', strategy: 'DIRECT', catalogBaseUnit: 'g' },
                reasonCodes: [],
                evidence: ['SKU aprobado.'],
                decisionRequired: null,
                alternatives: []
            }]
        }]
    };
}

describe('production recipe resolution contract', () => {
    it('reconciles all 8 recipes and 42 components without leaking unresolved decisions', async () => {
        const { document, map } = await loadProductionFixture();
        const report = prepareProductionRecipes(document, map, 'fixture-fingerprint');
        const components = map.recipes.flatMap((recipe) => recipe.components);

        expect(map.recipes).toHaveLength(8);
        expect(components).toHaveLength(42);
        expect(components.filter((component) => component.status === 'RESOLVED')).toHaveLength(42);
        expect(components.filter((component) => component.status === 'BLOCKED')).toHaveLength(0);
        expect(report.contractValid).toBe(true);
        expect(report.readyToApply).toBe(true);
        expect(report.readyRecipes).toHaveLength(8);
        expect(report.summary).toEqual(expect.objectContaining({
            sourceRecipes: 8,
            sourceComponents: 42,
            resolvedComponents: 42,
            blockedComponents: 0,
            resolvedOutputs: 8,
            blockedOutputs: 0,
            resolvedYields: 8,
            blockedYields: 0,
            readyRecipes: 8,
            blockedRecipes: 0
        }));
        expect(report.blockedDecisions).toHaveLength(0);
    });

    it('pins every evidence-backed candidate to the expected stable SKU', async () => {
        const { map } = await loadProductionFixture();
        const resolved = new Map(
            map.recipes.flatMap((recipe) => recipe.components)
                .filter((component) => component.status === 'RESOLVED')
                .map((component) => {
                    const recipe = map.recipes.find((candidate) => candidate.components.includes(component))!;
                    const mapping = component.mapping.status === 'RESOLVED' ? component.mapping : null;
                    return [`${recipe.sourceKey}|${component.sourceRow}`, mapping?.productSku];
                })
        );

        expect(Object.fromEntries(resolved)).toEqual({
            'Salsas!C5|10': 'VEG-000001',
            'Salsas!C5|11': 'MIS-000041',
            'Salsas!C5|12': 'VGR-000001',
            'Salsas!C5|13': 'CCI-C329AE1D78',
            'Salsas!N5|10': 'MIS-000078',
            'Salsas!N5|11': 'MIS-000041',
            'Salsas!N5|12': 'VGR-000001',
            'Salsas!N5|13': 'VEG-000001',
            'Salsas!N5|14': 'CCI-B227D34CC2',
            'Salsas!N5|15': 'CCI-FFE2D77F8F',
            'Salsas!N5|16': 'CCI-9C9C052E5D',
            'Salsas!AJ5|10': 'CCI-B39A60F59B',
            'Salsas!AJ5|11': 'VEG-000005',
            'Salsas!AJ5|12': 'VEG-000001',
            'Salsas!AJ5|13': 'MIS-000041',
            'Salsas!AJ5|14': 'CCI-C329AE1D78',
            'Salsas!AJ5|15': 'CON-000008',
            'Pitzas!C4|9': 'CON-000045',
            'Pitzas!C4|10': 'CON-000073',
            'Pitzas!C4|11': 'CCI-B227D34CC2',
            'Pitzas!C4|12': 'VEG-000001',
            'Pitzas!C4|13': 'CCI-8440C685DE',
            'Pitzas!C4|14': 'MIS-000050',
            'Pitzas!N4|9': 'CCI-25E4131C13',
            'Pitzas!N4|10': 'CON-000008',
            'Pitzas!N4|11': 'CCI-9C9C052E5D',
            'Pitzas!N4|12': 'CCI-FFE2D77F8F',
            'Pitzas nuevas!AB5|10': 'CCI-DAB047458A',
            'Pitzas nuevas!AB5|11': 'ING-000002',
            'Pitzas nuevas!AB5|12': 'CCI-FFE2D77F8F',
            'Pitzas nuevas!AB5|13': 'MIS-000047',
            'Pitzas nuevas!AB5|14': 'MIS-000002',
            'Pitzas nuevas!C29|34': 'ING-000002',
            'Pitzas nuevas!C29|35': 'CCI-179E185126',
            'Pitzas nuevas!C29|36': 'MIS-000002',
            'Pitzas nuevas!C29|37': 'MIS-000047',
            'Pitzas nuevas!C29|38': 'CCI-DAB047458A',
            'Pitzas nuevas!C29|39': 'CCI-FFE2D77F8F',
            'Pitzas nuevas!C29|40': 'CCI-AGUA-PROCESO',
            'Postres!U5|10': 'MIS-000002',
            'Postres!U5|11': 'CCI-D956E9FF8F',
            'Postres!U5|12': 'MIS-000059'
        });
    });

    it('documents all evidence-backed corrections while keeping workbook values immutable', async () => {
        const { document, map } = await loadProductionFixture();
        const report = prepareProductionRecipes(document, map, 'corrections');
        const resolved = map.recipes.flatMap((recipe) => recipe.components);
        const corrected = resolved.filter((component) =>
            component.unitResolution.resolvedQuantity !== undefined
            || component.unitResolution.resolvedUnit !== undefined
        );

        expect(corrected).toHaveLength(11);
        for (const component of corrected) {
            expect(component.unitResolution.strategy?.trim().length).toBeGreaterThan(0);
            expect(component.evidence.length).toBeGreaterThan(0);
            expect(component.status).toBe('RESOLVED');
        }

        const mappedTomato = map.recipes.find((item) => item.sourceKey === 'Salsas!C5')!
            .components.find((item) => item.sourceRow === 13)!;
        const preparedTomato = report.readyRecipes.find((item) => item.sourceKey === 'Salsas!C5')!
            .components.find((item) => item.sourceRow === 13)!;
        expect(mappedTomato).toEqual(expect.objectContaining({ quantity: 6, unit: 'unidad' }));
        expect(preparedTomato).toEqual(expect.objectContaining({ quantity: 15600, unit: 'g' }));

        const mappedOlive = map.recipes.find((item) => item.sourceKey === 'Salsas!C5')!
            .components.find((item) => item.sourceRow === 11)!;
        const preparedOlive = report.readyRecipes.find((item) => item.sourceKey === 'Salsas!C5')!
            .components.find((item) => item.sourceRow === 11)!;
        expect(mappedOlive.unit).toBe('g');
        expect(preparedOlive.unit).toBe('ml');
        expect(report.contractValid).toBe(true);
        expect(report.readyToApply).toBe(true);
    });

    it('rejects an invalid corrected quantity', () => {
        const map = simpleMap();
        map.recipes[0].components[0].unitResolution.resolvedQuantity = 0;
        map.recipes[0].components[0].unitResolution.resolvedUnit = 'g';

        const report = prepareProductionRecipes(simpleDocument(), map, 'bad-correction');

        expect(report.contractValid).toBe(false);
        expect(report.readyToApply).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'PRODUCTION_COMPONENT_RESOLVED_QUANTITY_INVALID' })
        ]));
    });

    it('emits only fully resolved recipes and preserves source quantities, units and yield', () => {
        const report = prepareProductionRecipes(simpleDocument(), simpleMap(), 'simple');

        expect(report.contractValid).toBe(true);
        expect(report.readyToApply).toBe(true);
        expect(report.readyRecipes).toHaveLength(1);
        expect(report.readyRecipes[0]).toEqual(expect.objectContaining({
            sourceKey: 'Produccion!A1',
            status: 'DRAFT',
            output: expect.objectContaining({
                name: 'Salida catálogo',
                sourceName: 'Salida fuente',
                sku: 'NEW-OUT',
                productSku: 'NEW-OUT'
            }),
            yield: { quantity: 10, unit: 'g' },
            components: [expect.objectContaining({
                name: 'Componente catálogo',
                sourceName: 'Componente fuente',
                sku: 'NEW-CMP',
                productSku: 'NEW-CMP',
                quantity: 2.5,
                unit: 'g',
                sourceRow: 2
            })]
        }));
    });

    it('rejects a stale quantity instead of silently applying a changed recipe', () => {
        const map = simpleMap();
        map.recipes[0].components[0].quantity = 3;

        const report = prepareProductionRecipes(simpleDocument(), map, 'stale');

        expect(report.contractValid).toBe(false);
        expect(report.readyToApply).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'PRODUCTION_MAP_COMPONENT_STALE' })
        ]));
    });
});

describe('production source cycle detection', () => {
    function recipe(outputSku: string, componentSku: string): NormalizedProductionRecipe {
        return {
            sourceKey: `Produccion!${outputSku}`,
            status: 'DRAFT',
            output: { name: outputSku, productSku: outputSku },
            yield: { quantity: 1, unit: 'g' },
            components: [{ name: componentSku, productSku: componentSku, quantity: 1, unit: 'g' }]
        };
    }

    it('finds a cycle among recipes from the same prepared contract', () => {
        expect(detectProductionCycles([
            recipe('OUT-A', 'OUT-B'),
            recipe('OUT-B', 'OUT-C'),
            recipe('OUT-C', 'OUT-A')
        ])).toEqual([['OUT-A', 'OUT-B', 'OUT-C', 'OUT-A']]);
    });

    it('ignores dependencies that are raw ingredients and accepts an acyclic chain', () => {
        expect(detectProductionCycles([
            recipe('OUT-A', 'OUT-B'),
            recipe('OUT-B', 'RAW-1')
        ])).toEqual([]);
    });
});
