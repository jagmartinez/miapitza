import { readFile } from 'fs/promises';
import path from 'path';

import { parseNormalizedMenuRecipes } from '../../services/menu-recipe-import.service';
import {
    prepareReviewedRecipes,
    ReviewResolutionMap
} from '../../scripts/prepare-reviewed-recipes';

const dataDir = path.resolve(process.cwd(), 'prisma/data');

async function fixture() {
    const [sourceRaw, mapRaw] = await Promise.all([
        readFile(path.join(dataDir, 'recetas-menu.normalized.json'), 'utf8'),
        readFile(path.join(dataDir, 'recetas-menu.review-map.json'), 'utf8')
    ]);
    const source = parseNormalizedMenuRecipes(JSON.parse(sourceRaw), { allowReviewRequired: true });
    if (!source.document) throw new Error('Fuente normalizada inválida.');
    return {
        source: source.document,
        map: JSON.parse(mapRaw) as ReviewResolutionMap
    };
}

describe('reviewRequired resolution map', () => {
    it('classifies every one of the 35 blocks exactly once', async () => {
        const { source, map } = await fixture();
        const report = prepareReviewedRecipes(source, map, 'fixture');

        expect(report.valid).toBe(true);
        expect(report.summary).toEqual({
            reviewBlocks: 35,
            decisions: 35,
            resolved: 28,
            blocked: 6,
            ignored: 1,
            menuRecipes: 26,
            menuRecipeLines: 67,
            productionRecipes: 2,
            productionComponentLines: 12
        });
        expect(report.issues).toEqual([]);
        expect(report.pending.filter((item) => item.status === 'BLOCKED')).toHaveLength(6);
        expect(report.pending.filter((item) => item.status === 'IGNORED')).toEqual([
            expect.objectContaining({ sourceKey: 'Bebidas!BL5' })
        ]);
    });

    it('produces a strict normalized document with unique menu targets', async () => {
        const { source, map } = await fixture();
        const report = prepareReviewedRecipes(source, map, 'fixture');
        const parsed = parseNormalizedMenuRecipes(report.document);

        expect(parsed.document).not.toBeNull();
        expect(parsed.issues.filter((entry) => entry.severity === 'ERROR')).toEqual([]);
        expect(new Set(report.menuItems.map((item) => item.name)).size).toBe(26);
        expect(report.document.reviewRequired).toEqual([]);
    });

    it('normalizes the three-serving ravioli batch per sold plate', async () => {
        const { source, map } = await fixture();
        const report = prepareReviewedRecipes(source, map, 'fixture');
        const ravioli = report.document.recipes.find((recipe) => recipe.sourceKey === 'Pastas!BV42');

        expect(ravioli?.ingredients).toEqual([
            expect.objectContaining({ productSku: 'CON-000066', quantity: 0.333, unit: 'lb' }),
            expect.objectContaining({ productSku: 'RCP-000003', quantity: 56, unit: 'g' })
        ]);
    });

    it('keeps unsafe unknown measures and variable bundles blocked', async () => {
        const { source, map } = await fixture();
        const report = prepareReviewedRecipes(source, map, 'fixture');
        const blockedKeys = report.pending
            .filter((item) => item.status === 'BLOCKED')
            .map((item) => item.sourceKey)
            .sort();

        expect(blockedKeys).toEqual([
            'PROMOCION!C5',
            'Pastas!CG42',
            'Pitzas!DU3',
            'Postres!AL5',
            'Postres!C5',
            'Salsas!Y5'
        ]);
    });

    it('fails closed when a source line loses its explicit product mapping', async () => {
        const { source, map } = await fixture();
        const decision = map.decisions.find((item) => item.sourceKey === 'Pastas!C5')!;
        decision.ingredients = decision.ingredients?.filter((item) => item.sourceRow !== 10);

        const report = prepareReviewedRecipes(source, map, 'missing');

        expect(report.valid).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'REVIEW_MAPPING_MISSING' })
        ]));
    });
});
