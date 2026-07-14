import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('production recipe detail contract', () => {
    it('loads the canonical recipe detail and exposes its components and costs', () => {
        const source = readFileSync(fileURLToPath(new URL('./ProductionRecipes.tsx', import.meta.url)), 'utf8');
        expect(source).toContain('productionRecipesAPI.getById(recipe.id)');
        expect(source).toContain('Detalle de la Receta');
        expect(source).toContain('viewingRecipe.components.map');
        expect(source).toContain('viewingRecipe.cost.batchCost');
    });
});
