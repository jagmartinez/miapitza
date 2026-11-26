import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('production recipe detail contract', () => {
    it('loads the canonical recipe detail and exposes its components and costs', () => {
        const source = readFileSync(fileURLToPath(new URL('./ProductionRecipes.tsx', import.meta.url)), 'utf8');
        expect(source).toContain('productionRecipesAPI.getById(recipe.id)');
        // Maestro-detalle del mockup: panel lateral con tabla de componentes (sin la ficha heredada inventory-detail).
        expect(source).toContain('aria-label="Detalle de la receta"');
        expect(source).toContain('data-testid="production-recipe-detail"');
        expect(source).toContain('ariaLabel="Componentes de la receta"');
        expect(source).not.toContain('inventory-detail');
        expect(source).toContain('Componentes de la preparación');
        expect(source).toContain('viewingRecipe.components.map');
        expect(source).toContain('viewingRecipe.cost.batchCost');
    });
});
