import type { Prisma } from '@prisma/client';

import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import type { MenuRecipeImportIssue, NormalizedRecipeIngredient } from './menu-recipe-import.service';

type ImportDb = Prisma.TransactionClient | typeof prisma;

export interface NormalizedProductionOutputReference {
    name: string;
    sourceName?: string | null;
    sku?: string | null;
    productSku?: string | null;
}

export interface NormalizedProductionRecipe {
    sourceKey: string;
    sourceRow?: number | null;
    name?: string | null;
    status: 'DRAFT' | 'ACTIVE';
    output: NormalizedProductionOutputReference;
    yield: {
        quantity: number;
        unit: string;
    };
    components: NormalizedRecipeIngredient[];
    source?: Record<string, unknown> | null;
}

export type PlannedProductionAction = 'CREATE_VERSION' | 'UNCHANGED';

export interface PlannedProductionComponent {
    productId: number;
    productSku: string | null;
    productName: string;
    sourceName: string;
    quantity: number;
    unitId: number;
    unit: string;
    sourceRow: number | null;
}

export interface PlannedProductionRecipe {
    sourceKey: string;
    sourceRow: number | null;
    action: PlannedProductionAction;
    existingRecipeId: number | null;
    outputProductId: number;
    outputProductSku: string | null;
    outputProductName: string;
    sourceOutputName: string;
    name: string;
    version: number;
    status: 'DRAFT' | 'ACTIVE';
    yieldQuantity: number;
    yieldUnitId: number;
    yieldUnit: string;
    components: PlannedProductionComponent[];
    deactivateRecipeIds: number[];
}

export interface ProductionRecipeImportSummary {
    productionRecipesInFile: number;
    productionRecipesResolved: number;
    productionComponentLines: number;
    productionVersionsCreated: number;
    productionRecipesUnchanged: number;
    productionRecipesDeactivated: number;
}

export interface ProductionRecipeImportPlan {
    valid: boolean;
    issues: MenuRecipeImportIssue[];
    recipes: PlannedProductionRecipe[];
    summary: ProductionRecipeImportSummary;
}

type ProductCatalogRow = {
    id: number;
    name: string;
    sku: string | null;
    unit: string;
    type: string;
    active: boolean;
};

type UnitCatalogRow = {
    id: number;
    name: string;
    abbreviation: string;
    active: boolean;
};

type ExistingProductionRecipe = {
    id: number;
    productId: number;
    name: string;
    version: number;
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
    yieldQuantity: Prisma.Decimal;
    yieldUnitId: number | null;
    components: Array<{
        componentProductId: number;
        quantity: Prisma.Decimal;
        unitId: number | null;
        unit: string | null;
    }>;
};

const PRODUCIBLE_TYPES = new Set(['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH']);

const UNIT_ALIASES: Record<string, string> = {
    gr: 'g',
    grs: 'g',
    gramo: 'g',
    gramos: 'g',
    kilo: 'kg',
    kilos: 'kg',
    kgs: 'kg',
    kilogramo: 'kg',
    kilogramos: 'kg',
    lt: 'l',
    lts: 'l',
    litro: 'l',
    litros: 'l',
    mililitro: 'ml',
    mililitros: 'ml',
    und: 'unidad',
    unid: 'unidad',
    u: 'unidad',
    unidades: 'unidad',
    lamina: 'unidad',
    laminas: 'unidad'
};

function normalizeText(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('es')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function normalizeCode(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeUnit(value: string): string {
    const key = normalizeText(value).replace(/[.\s_-]+/g, '');
    return UNIT_ALIASES[key] ?? key;
}

function makeIssue(
    severity: 'ERROR' | 'WARNING',
    code: string,
    path: string,
    message: string,
    context?: Record<string, unknown>
): MenuRecipeImportIssue {
    return { severity, code, path, message, ...(context ? { context } : {}) };
}

function sameQuantity(left: number, right: number): boolean {
    return Math.abs(left - right) <= 1e-9;
}

function boundedLevenshtein(left: string, right: string): number {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let diagonal = previous[0];
        previous[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const above = previous[rightIndex];
            previous[rightIndex] = Math.min(
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + 1,
                diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
            );
            diagonal = above;
        }
    }
    return previous[right.length];
}

function suggestProducts(
    reference: { name: string; sku?: string | null; productSku?: string | null },
    products: ProductCatalogRow[]
): Array<{ id: number; sku: string | null; name: string }> {
    const name = normalizeText(reference.name);
    const sku = normalizeCode(reference.productSku ?? reference.sku ?? '');
    return products
        .map((product) => {
            const candidateName = normalizeText(product.name);
            const candidateSku = normalizeCode(product.sku ?? '');
            const nameDistance = boundedLevenshtein(name, candidateName);
            const skuDistance = sku && candidateSku ? boundedLevenshtein(sku, candidateSku) : Number.POSITIVE_INFINITY;
            const contains = name.length >= 3 && (candidateName.includes(name) || name.includes(candidateName));
            const nameLimit = Math.min(3, Math.max(1, Math.floor(name.length * 0.25)));
            const eligible = contains || nameDistance <= nameLimit || skuDistance <= 2;
            return { product, eligible, score: contains ? 0 : Math.min(nameDistance, skuDistance) };
        })
        .filter((entry) => entry.eligible)
        .sort((left, right) => left.score - right.score || left.product.name.localeCompare(right.product.name))
        .slice(0, 8)
        .map(({ product }) => ({ id: product.id, sku: product.sku, name: product.name }));
}

function resolveProducts(
    reference: { name: string; sku?: string | null; productSku?: string | null },
    products: ProductCatalogRow[]
): ProductCatalogRow[] {
    const sku = reference.productSku ?? reference.sku;
    if (sku) return products.filter((product) => normalizeCode(product.sku ?? '') === normalizeCode(sku));
    return products.filter((product) => normalizeText(product.name) === normalizeText(reference.name));
}

function resolveUnits(raw: string, units: UnitCatalogRow[]): UnitCatalogRow[] {
    const literal = normalizeText(raw).replace(/[.\s_-]+/g, '');
    const requested = normalizeUnit(raw);
    const exact = units.filter((unit) => normalizeText(unit.abbreviation).replace(/[.\s_-]+/g, '') === literal);
    const activeExact = exact.filter((unit) => unit.active);
    if (activeExact.length > 0) return activeExact;
    const aliases = units.filter((unit) => normalizeUnit(unit.abbreviation) === requested);
    const activeAliases = aliases.filter((unit) => unit.active);
    if (activeAliases.length > 0) return activeAliases;
    if (exact.length > 0) return exact;
    if (aliases.length > 0) return aliases;
    const names = units.filter((unit) => normalizeText(unit.name).replace(/\s+/g, '') === requested);
    const activeNames = names.filter((unit) => unit.active);
    return activeNames.length > 0 ? activeNames : names;
}

function productionRecipeMatches(
    existing: ExistingProductionRecipe,
    desired: {
        yieldQuantity: number;
        yieldUnitId: number;
        components: PlannedProductionComponent[];
    }
): boolean {
    if (!sameQuantity(Number(existing.yieldQuantity), desired.yieldQuantity)) return false;
    if (existing.yieldUnitId !== desired.yieldUnitId) return false;
    if (existing.components.length !== desired.components.length) return false;

    const desiredByProduct = new Map(desired.components.map((component) => [component.productId, component]));
    return existing.components.every((component) => {
        const expected = desiredByProduct.get(component.componentProductId);
        return Boolean(expected)
            && sameQuantity(Number(component.quantity), expected!.quantity)
            && component.unitId === expected!.unitId
            && normalizeUnit(component.unit ?? '') === normalizeUnit(expected!.unit);
    });
}

function findReachableCycle(graph: Map<number, number[]>, start: number): number[] | null {
    const completed = new Set<number>();

    const visit = (node: number, path: number[], positions: Map<number, number>): number[] | null => {
        const existingPosition = positions.get(node);
        if (existingPosition !== undefined) return [...path.slice(existingPosition), node];
        if (completed.has(node)) return null;

        const nextPositions = new Map(positions);
        nextPositions.set(node, path.length);
        const nextPath = [...path, node];
        for (const child of graph.get(node) ?? []) {
            const cycle = visit(child, nextPath, nextPositions);
            if (cycle) return cycle;
        }
        completed.add(node);
        return null;
    };

    return visit(start, [], new Map());
}

export class ProductionRecipeImportService {
    static emptySummary(recipes: NormalizedProductionRecipe[]): ProductionRecipeImportSummary {
        return {
            productionRecipesInFile: recipes.length,
            productionRecipesResolved: 0,
            productionComponentLines: recipes.reduce((sum, recipe) => sum + recipe.components.length, 0),
            productionVersionsCreated: 0,
            productionRecipesUnchanged: 0,
            productionRecipesDeactivated: 0
        };
    }

    static async plan(
        documentRecipes: NormalizedProductionRecipe[],
        companyId: number,
        db: ImportDb = prisma
    ): Promise<ProductionRecipeImportPlan> {
        const issues: MenuRecipeImportIssue[] = [];
        const summary = this.emptySummary(documentRecipes);
        const result: ProductionRecipeImportPlan = { valid: false, issues, recipes: [], summary };
        if (documentRecipes.length === 0) {
            result.valid = true;
            return result;
        }

        const [products, units, existingRecipes] = await Promise.all([
            db.product.findMany({
                where: { companyId },
                select: { id: true, name: true, sku: true, unit: true, type: true, active: true }
            }) as unknown as Promise<ProductCatalogRow[]>,
            db.unitOfMeasure.findMany({
                where: { companyId },
                select: { id: true, name: true, abbreviation: true, active: true }
            }) as unknown as Promise<UnitCatalogRow[]>,
            db.productionRecipe.findMany({
                where: { companyId },
                include: { components: true },
                orderBy: { version: 'desc' }
            }) as unknown as Promise<ExistingProductionRecipe[]>
        ]);

        const targetIndexes = new Map<number, number>();

        for (let recipeIndex = 0; recipeIndex < documentRecipes.length; recipeIndex++) {
            const sourceRecipe = documentRecipes[recipeIndex];
            const recipePath = `$.productionRecipes[${recipeIndex}]`;
            const outputCandidates = resolveProducts(sourceRecipe.output, products);
            if (outputCandidates.length === 0) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_OUTPUT_NOT_FOUND',
                    `${recipePath}.output`,
                    `No se encontró el producto de salida "${sourceRecipe.output.name}"${sourceRecipe.output.productSku || sourceRecipe.output.sku ? ` (SKU ${sourceRecipe.output.productSku ?? sourceRecipe.output.sku})` : ''}.`,
                    {
                        reference: sourceRecipe.output,
                        suggestions: suggestProducts(sourceRecipe.output, products)
                    }
                ));
                continue;
            }
            if (outputCandidates.length > 1) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_OUTPUT_AMBIGUOUS',
                    `${recipePath}.output`,
                    `El producto de salida "${sourceRecipe.output.name}" es ambiguo; indique productSku.`,
                    { candidates: outputCandidates.map((product) => ({ id: product.id, sku: product.sku, name: product.name, type: product.type })) }
                ));
                continue;
            }
            const output = outputCandidates[0];
            if (!output.active) {
                issues.push(makeIssue('ERROR', 'PRODUCTION_OUTPUT_INACTIVE', `${recipePath}.output`, `El producto de salida ${output.sku ?? output.id} está inactivo.`));
                continue;
            }
            if (!PRODUCIBLE_TYPES.has(output.type)) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_OUTPUT_TYPE_INVALID',
                    `${recipePath}.output`,
                    `El producto ${output.sku ?? output.id} tiene tipo ${output.type}; debe ser INTERMEDIATE, PRODUCT_FOR_SALE o BOTH antes de importar.`,
                    { productId: output.id, productSku: output.sku, currentType: output.type }
                ));
                continue;
            }
            const outputSku = sourceRecipe.output.productSku ?? sourceRecipe.output.sku;
            const sourceOutputName = sourceRecipe.output.sourceName ?? sourceRecipe.output.name;
            if (outputSku && normalizeText(output.name) !== normalizeText(sourceRecipe.output.name)) {
                issues.push(makeIssue(
                    'WARNING',
                    'PRODUCTION_OUTPUT_NAME_DIFFERS_FROM_CATALOG',
                    `${recipePath}.output`,
                    `El nombre fuente "${sourceRecipe.output.name}" difiere de "${output.name}"; se usará el SKU exacto "${outputSku}".`,
                    { outputProductId: output.id, outputProductSku: output.sku, sourceName: sourceRecipe.output.name, catalogName: output.name }
                ));
            }
            const duplicateTarget = targetIndexes.get(output.id);
            if (duplicateTarget !== undefined) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_OUTPUT_DUPLICATE',
                    `${recipePath}.output`,
                    `Dos recetas de producción resuelven al mismo producto de salida ${output.sku ?? output.id}.`,
                    { previousPath: `$.productionRecipes[${duplicateTarget}]` }
                ));
                continue;
            }
            targetIndexes.set(output.id, recipeIndex);

            const yieldUnits = resolveUnits(sourceRecipe.yield.unit, units);
            if (yieldUnits.length !== 1) {
                issues.push(makeIssue(
                    'ERROR',
                    yieldUnits.length === 0 ? 'PRODUCTION_YIELD_UNIT_NOT_FOUND' : 'PRODUCTION_YIELD_UNIT_AMBIGUOUS',
                    `${recipePath}.yield.unit`,
                    yieldUnits.length === 0
                        ? `No existe la unidad de rendimiento "${sourceRecipe.yield.unit}".`
                        : `La unidad de rendimiento "${sourceRecipe.yield.unit}" es ambigua.`,
                    yieldUnits.length > 1
                        ? { candidates: yieldUnits.map((unit) => ({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation })) }
                        : undefined
                ));
                continue;
            }
            const yieldUnit = yieldUnits[0];
            if (!yieldUnit.active) {
                issues.push(makeIssue('ERROR', 'PRODUCTION_YIELD_UNIT_INACTIVE', `${recipePath}.yield.unit`, `La unidad ${yieldUnit.abbreviation} está inactiva.`));
                continue;
            }
            try {
                await UnitConversionService.convert(
                    output.id,
                    companyId,
                    sourceRecipe.yield.quantity,
                    yieldUnit.abbreviation,
                    db as Prisma.TransactionClient
                );
            } catch (error) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_YIELD_UNIT_INCOMPATIBLE',
                    `${recipePath}.yield.unit`,
                    error instanceof Error ? error.message : 'La unidad de rendimiento no es compatible.',
                    { outputProductId: output.id, yieldUnitId: yieldUnit.id }
                ));
                continue;
            }

            const components: PlannedProductionComponent[] = [];
            const componentIndexes = new Map<number, number>();
            for (let componentIndex = 0; componentIndex < sourceRecipe.components.length; componentIndex++) {
                const sourceComponent = sourceRecipe.components[componentIndex];
                const componentPath = `${recipePath}.components[${componentIndex}]`;
                const componentCandidates = resolveProducts(sourceComponent, products);
                if (componentCandidates.length === 0) {
                    issues.push(makeIssue(
                        'ERROR',
                        'PRODUCTION_COMPONENT_NOT_FOUND',
                        componentPath,
                        `No se encontró el componente "${sourceComponent.name}"${sourceComponent.productSku || sourceComponent.sku ? ` (SKU ${sourceComponent.productSku ?? sourceComponent.sku})` : ''}.`,
                        {
                            name: sourceComponent.name,
                            sku: sourceComponent.productSku ?? sourceComponent.sku ?? null,
                            suggestions: suggestProducts(sourceComponent, products)
                        }
                    ));
                    continue;
                }
                if (componentCandidates.length > 1) {
                    issues.push(makeIssue(
                        'ERROR',
                        'PRODUCTION_COMPONENT_AMBIGUOUS',
                        componentPath,
                        `El componente "${sourceComponent.name}" es ambiguo; indique productSku.`,
                        { candidates: componentCandidates.map((product) => ({ id: product.id, sku: product.sku, name: product.name })) }
                    ));
                    continue;
                }
                const component = componentCandidates[0];
                if (!component.active) {
                    issues.push(makeIssue('ERROR', 'PRODUCTION_COMPONENT_INACTIVE', componentPath, `El componente ${component.sku ?? component.id} está inactivo.`));
                    continue;
                }
                if (component.id === output.id) {
                    issues.push(makeIssue('ERROR', 'PRODUCTION_SELF_REFERENCE', componentPath, 'Una receta de producción no puede contener su producto de salida como componente.'));
                    continue;
                }
                const duplicateComponent = componentIndexes.get(component.id);
                if (duplicateComponent !== undefined) {
                    issues.push(makeIssue(
                        'ERROR',
                        'PRODUCTION_COMPONENT_DUPLICATE',
                        componentPath,
                        `El producto ${component.sku ?? component.id} aparece más de una vez; consolide sus cantidades.`,
                        { previousPath: `${recipePath}.components[${duplicateComponent}]` }
                    ));
                    continue;
                }
                componentIndexes.set(component.id, componentIndex);

                const componentSku = sourceComponent.productSku ?? sourceComponent.sku;
                if (componentSku && normalizeText(component.name) !== normalizeText(sourceComponent.name)) {
                    issues.push(makeIssue(
                        'WARNING',
                        'PRODUCTION_COMPONENT_NAME_DIFFERS_FROM_CATALOG',
                        componentPath,
                        `El nombre fuente "${sourceComponent.name}" difiere de "${component.name}"; se usará el SKU exacto "${componentSku}".`,
                        { componentProductId: component.id, componentProductSku: component.sku, sourceName: sourceComponent.name, catalogName: component.name }
                    ));
                }

                const componentUnits = resolveUnits(sourceComponent.unit, units);
                if (componentUnits.length !== 1) {
                    issues.push(makeIssue(
                        'ERROR',
                        componentUnits.length === 0 ? 'PRODUCTION_COMPONENT_UNIT_NOT_FOUND' : 'PRODUCTION_COMPONENT_UNIT_AMBIGUOUS',
                        `${componentPath}.unit`,
                        componentUnits.length === 0
                            ? `No existe la unidad "${sourceComponent.unit}" para ${component.name}.`
                            : `La unidad "${sourceComponent.unit}" es ambigua.`,
                        componentUnits.length > 1
                            ? { candidates: componentUnits.map((unit) => ({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation })) }
                            : undefined
                    ));
                    continue;
                }
                const componentUnit = componentUnits[0];
                if (!componentUnit.active) {
                    issues.push(makeIssue('ERROR', 'PRODUCTION_COMPONENT_UNIT_INACTIVE', `${componentPath}.unit`, `La unidad ${componentUnit.abbreviation} está inactiva.`));
                    continue;
                }
                try {
                    await UnitConversionService.convert(
                        component.id,
                        companyId,
                        sourceComponent.quantity,
                        componentUnit.abbreviation,
                        db as Prisma.TransactionClient
                    );
                } catch (error) {
                    issues.push(makeIssue(
                        'ERROR',
                        'PRODUCTION_COMPONENT_UNIT_INCOMPATIBLE',
                        `${componentPath}.unit`,
                        error instanceof Error ? error.message : 'La unidad no es compatible con el componente.',
                        { componentProductId: component.id, componentProductSku: component.sku, unitId: componentUnit.id }
                    ));
                    continue;
                }

                components.push({
                    productId: component.id,
                    productSku: component.sku,
                    productName: component.name,
                    sourceName: sourceComponent.sourceName ?? sourceComponent.name,
                    quantity: sourceComponent.quantity,
                    unitId: componentUnit.id,
                    unit: componentUnit.abbreviation,
                    sourceRow: sourceComponent.sourceRow ?? null
                });
            }

            if (components.length !== sourceRecipe.components.length) continue;

            const versions = existingRecipes.filter((recipe) => recipe.productId === output.id);
            const activeVersions = versions.filter((recipe) => recipe.status === 'ACTIVE');
            if (activeVersions.length > 1) {
                issues.push(makeIssue(
                    'ERROR',
                    'PRODUCTION_MULTIPLE_ACTIVE_VERSIONS',
                    recipePath,
                    `El producto ${output.sku ?? output.id} ya tiene ${activeVersions.length} recetas ACTIVE. Corrija el catálogo antes de importar.`,
                    { recipeIds: activeVersions.map((recipe) => recipe.id) }
                ));
                continue;
            }

            const comparisonTarget = sourceRecipe.status === 'ACTIVE'
                ? activeVersions[0]
                : versions.filter((recipe) => recipe.status === 'DRAFT').sort((left, right) => right.version - left.version)[0];
            const desired = {
                yieldQuantity: sourceRecipe.yield.quantity,
                yieldUnitId: yieldUnit.id,
                components
            };
            const unchanged = comparisonTarget && productionRecipeMatches(comparisonTarget, desired);
            const maxVersion = versions.reduce((max, recipe) => Math.max(max, recipe.version), 0);
            const action: PlannedProductionAction = unchanged ? 'UNCHANGED' : 'CREATE_VERSION';
            const planned: PlannedProductionRecipe = {
                sourceKey: sourceRecipe.sourceKey,
                sourceRow: sourceRecipe.sourceRow ?? null,
                action,
                existingRecipeId: unchanged ? comparisonTarget.id : null,
                outputProductId: output.id,
                outputProductSku: output.sku,
                outputProductName: output.name,
                sourceOutputName,
                name: sourceRecipe.name?.trim() || `Receta de ${output.name}`,
                version: unchanged ? comparisonTarget.version : maxVersion + 1,
                status: sourceRecipe.status,
                yieldQuantity: sourceRecipe.yield.quantity,
                yieldUnitId: yieldUnit.id,
                yieldUnit: yieldUnit.abbreviation,
                components,
                deactivateRecipeIds: action === 'CREATE_VERSION' && sourceRecipe.status === 'ACTIVE'
                    ? activeVersions.map((recipe) => recipe.id)
                    : []
            };
            result.recipes.push(planned);
            if (action === 'CREATE_VERSION') {
                summary.productionVersionsCreated++;
                summary.productionRecipesDeactivated += planned.deactivateRecipeIds.length;
            } else {
                summary.productionRecipesUnchanged++;
            }
        }

        summary.productionRecipesResolved = result.recipes.length;

        // Validate the graph that would exist after activating every requested
        // ACTIVE recipe, including dependencies among recipes from this same file.
        const graph = new Map<number, number[]>();
        for (const existing of existingRecipes.filter((recipe) => recipe.status === 'ACTIVE')) {
            graph.set(existing.productId, existing.components.map((component) => component.componentProductId));
        }
        const activePlans = result.recipes.filter((recipe) => recipe.status === 'ACTIVE');
        for (const planned of activePlans) {
            graph.set(planned.outputProductId, planned.components.map((component) => component.productId));
        }
        const productById = new Map(products.map((product) => [product.id, product]));
        for (const planned of activePlans) {
            const cycle = findReachableCycle(graph, planned.outputProductId);
            if (!cycle) continue;
            const sourceIndex = documentRecipes.findIndex((recipe) => recipe.sourceKey === planned.sourceKey);
            issues.push(makeIssue(
                'ERROR',
                'PRODUCTION_CIRCULAR_DEPENDENCY',
                `$.productionRecipes[${sourceIndex}]`,
                `La activación alcanzaría una dependencia circular: ${cycle.map((id) => productById.get(id)?.name ?? `Producto ${id}`).join(' -> ')}.`,
                { rootProductId: planned.outputProductId, productIds: cycle }
            ));
        }

        result.valid = !issues.some((entry) => entry.severity === 'ERROR')
            && result.recipes.length === documentRecipes.length;
        return result;
    }

    static async applyPlan(
        tx: Prisma.TransactionClient,
        plan: ProductionRecipeImportPlan,
        context: {
            companyId: number;
            userId: number;
            fingerprint: string;
            source: unknown;
            allowReviewRequired?: boolean;
            reviewRequiredExcluded?: number;
        }
    ): Promise<void> {
        for (const recipe of plan.recipes) {
            if (recipe.action === 'UNCHANGED') continue;

            if (recipe.deactivateRecipeIds.length > 0) {
                await tx.productionRecipe.updateMany({
                    where: {
                        companyId: context.companyId,
                        id: { in: recipe.deactivateRecipeIds },
                        status: 'ACTIVE'
                    },
                    data: { status: 'INACTIVE' }
                });
            }

            const created = await tx.productionRecipe.create({
                data: {
                    companyId: context.companyId,
                    productId: recipe.outputProductId,
                    name: recipe.name,
                    version: recipe.version,
                    status: recipe.status,
                    yieldQuantity: recipe.yieldQuantity,
                    yieldUnitId: recipe.yieldUnitId,
                    createdById: context.userId,
                    notes: `Importado desde ${recipe.sourceKey}`,
                    components: {
                        create: recipe.components.map((component) => ({
                            componentProductId: component.productId,
                            quantity: component.quantity,
                            unitId: component.unitId,
                            unit: component.unit,
                            notes: component.sourceRow ? `Fila fuente ${component.sourceRow}` : null
                        }))
                    }
                },
                select: { id: true }
            });

            await tx.auditLog.create({
                data: {
                    companyId: context.companyId,
                    userId: context.userId,
                    entityType: 'ProductionRecipe',
                    entityId: created.id,
                    action: 'IMPORT',
                    details: {
                        source: context.source as Prisma.InputJsonValue,
                        sourceFingerprint: context.fingerprint,
                        allowReviewRequired: context.allowReviewRequired === true,
                        reviewRequiredExcluded: context.reviewRequiredExcluded ?? 0,
                        sourceKey: recipe.sourceKey,
                        sourceRow: recipe.sourceRow,
                        outputProductId: recipe.outputProductId,
                        outputProductSku: recipe.outputProductSku,
                        version: recipe.version,
                        status: recipe.status,
                        yieldQuantity: recipe.yieldQuantity,
                        yieldUnit: recipe.yieldUnit,
                        componentProductIds: recipe.components.map((component) => component.productId),
                        componentMappings: recipe.components.map((component) => ({
                            sourceName: component.sourceName,
                            productId: component.productId,
                            productSku: component.productSku,
                            catalogName: component.productName,
                            quantity: component.quantity,
                            unit: component.unit,
                            sourceRow: component.sourceRow
                        })),
                        deactivatedRecipeIds: recipe.deactivateRecipeIds
                    } as Prisma.InputJsonValue
                }
            });
        }
    }
}
