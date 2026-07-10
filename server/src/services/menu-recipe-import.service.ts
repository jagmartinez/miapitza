import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import {
    NormalizedProductionRecipe,
    PlannedProductionRecipe,
    ProductionRecipeImportService
} from './production-recipe-import.service';

type ImportDb = Prisma.TransactionClient | typeof prisma;

export type ImportIssueSeverity = 'ERROR' | 'WARNING';

export interface MenuRecipeImportIssue {
    severity: ImportIssueSeverity;
    code: string;
    path: string;
    message: string;
    context?: Record<string, unknown>;
}

export interface NormalizedMenuItemReference {
    name: string;
    category?: string | null;
    brand?: string | null;
    branchCode?: string | null;
}

export interface NormalizedRecipeIngredient {
    name: string;
    sourceName?: string | null;
    sku?: string | null;
    productSku?: string | null;
    quantity: number;
    unit: string;
    sourceRow?: number | null;
    quantityRaw?: unknown;
    unitRaw?: unknown;
    source?: Record<string, unknown> | null;
    formulas?: Record<string, unknown> | null;
}

export interface NormalizedMenuRecipe {
    code?: string | null;
    sourceKey?: string | null;
    sourceRow?: number | null;
    variantQualifier?: string | null;
    menuItem: NormalizedMenuItemReference;
    ingredients: NormalizedRecipeIngredient[];
    source?: Record<string, unknown> | null;
}

export interface NormalizedMenuRecipeDocument {
    schemaVersion: 1;
    source: {
        file: string;
        sheet?: string | null;
        generatedAt?: string | null;
        sha256?: string | null;
        templateFile?: string | null;
        templateSha256?: string | null;
    };
    recipes: NormalizedMenuRecipe[];
    productionRecipes: NormalizedProductionRecipe[];
    reviewRequired: unknown[];
}

export type PlannedLineAction = 'CREATE' | 'UPDATE' | 'UNCHANGED';

export interface PlannedRecipeLine {
    action: PlannedLineAction;
    existingRecipeId: number | null;
    productId: number;
    productSku: string | null;
    productName: string;
    sourceName: string;
    quantity: number;
    unitId: number;
    unit: string;
    sourceRow: number | null;
}

export interface PlannedRecipeDeletion {
    recipeId: number;
    productId: number;
    productSku: string | null;
    productName: string;
    quantity: number;
    unitId: number | null;
    unit: string | null;
}

export interface PlannedMenuRecipe {
    sourceKey: string | null;
    sourceCode: string | null;
    sourceRow: number | null;
    variantQualifier: string | null;
    menuItemId: number;
    menuItemName: string;
    category: string;
    brand: string | null;
    branchCode: string | null;
    lines: PlannedRecipeLine[];
    deletions: PlannedRecipeDeletion[];
}

export interface MenuRecipeImportSummary {
    recipesInFile: number;
    recipesResolved: number;
    linesInFile: number;
    creates: number;
    updates: number;
    deletes: number;
    unchanged: number;
    preserved: number;
    productionRecipesInFile: number;
    productionRecipesResolved: number;
    productionComponentLines: number;
    productionVersionsCreated: number;
    productionRecipesUnchanged: number;
    productionRecipesDeactivated: number;
    reviewRequired: number;
}

export interface MenuRecipeImportReport {
    valid: boolean;
    applied: boolean;
    dryRun: boolean;
    replace: boolean;
    allowReviewRequired: boolean;
    skipProductionRecipes: boolean;
    companyId: number;
    userId: number | null;
    fingerprint: string;
    source: NormalizedMenuRecipeDocument['source'] | null;
    summary: MenuRecipeImportSummary;
    issues: MenuRecipeImportIssue[];
    recipes: PlannedMenuRecipe[];
    productionRecipes: PlannedProductionRecipe[];
    catalog: {
        products: Array<{
            id: number;
            name: string;
            sku: string | null;
            type: string;
            unit: string;
            baseUnitId: number | null;
            active: boolean;
        }>;
        unitsOfMeasure: UnitCatalogRow[];
    };
}

export interface MenuRecipeImportOptions {
    companyId: number;
    userId?: number | null;
    dryRun?: boolean;
    replace?: boolean;
    allowReviewRequired?: boolean;
    skipProductionRecipes?: boolean;
    client?: typeof prisma;
}

type ParsedDocumentResult = {
    document: NormalizedMenuRecipeDocument | null;
    issues: MenuRecipeImportIssue[];
    fingerprint: string;
};

type MenuItemCatalogRow = {
    id: number;
    name: string;
    active: boolean;
    category: { name: string };
    brand: { name: string } | null;
    branch: { code: string } | null;
};

type ProductCatalogRow = {
    id: number;
    name: string;
    sku: string | null;
    unit: string;
    type: string;
    baseUnitId: number | null;
    active: boolean;
};

type UnitCatalogRow = {
    id: number;
    name: string;
    abbreviation: string;
    active: boolean;
};

type ExistingRecipeRow = {
    id: number;
    menuItemId: number;
    productId: number;
    quantity: Prisma.Decimal;
    unit: string | null;
    unitId: number | null;
    product: { id: number; name: string; sku: string | null };
};

const EMPTY_SUMMARY: MenuRecipeImportSummary = {
    recipesInFile: 0,
    recipesResolved: 0,
    linesInFile: 0,
    creates: 0,
    updates: 0,
    deletes: 0,
    unchanged: 0,
    preserved: 0,
    productionRecipesInFile: 0,
    productionRecipesResolved: 0,
    productionComponentLines: 0,
    productionVersionsCreated: 0,
    productionRecipesUnchanged: 0,
    productionRecipesDeactivated: 0,
    reviewRequired: 0
};

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

function normalizeUnitKey(value: string): string {
    const normalized = normalizeText(value).replace(/[.\s_-]+/g, '');
    return UNIT_ALIASES[normalized] ?? normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanOptionalString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned || null;
}

function decimalPlaces(value: number): number {
    const rendered = value.toString().toLowerCase();
    if (rendered.includes('e-')) {
        const [coefficient, exponentRaw] = rendered.split('e-');
        const exponent = Number(exponentRaw);
        const decimals = coefficient.split('.')[1]?.length ?? 0;
        return exponent + decimals;
    }
    return rendered.split('.')[1]?.length ?? 0;
}

function issue(
    severity: ImportIssueSeverity,
    code: string,
    path: string,
    message: string,
    context?: Record<string, unknown>
): MenuRecipeImportIssue {
    return { severity, code, path, message, ...(context ? { context } : {}) };
}

function canonicalJson(value: unknown): string {
    if (value === undefined) return '"[undefined]"';
    if (typeof value === 'bigint') return JSON.stringify(`[bigint:${value.toString()}]`);
    if (typeof value === 'function' || typeof value === 'symbol') return JSON.stringify(String(value));
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? JSON.stringify(String(value));
}

function fingerprint(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
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
    reference: { name: string; sku?: string | null },
    products: ProductCatalogRow[]
): Array<{ id: number; sku: string | null; name: string }> {
    const name = normalizeText(reference.name);
    const sku = normalizeCode(reference.sku ?? '');
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

function emptyReport(
    options: Pick<MenuRecipeImportOptions, 'companyId' | 'userId' | 'dryRun' | 'replace' | 'allowReviewRequired' | 'skipProductionRecipes'>,
    parsed: ParsedDocumentResult
): MenuRecipeImportReport {
    return {
        valid: false,
        applied: false,
        dryRun: options.dryRun !== false,
        replace: options.replace === true,
        allowReviewRequired: options.allowReviewRequired === true,
        skipProductionRecipes: options.skipProductionRecipes === true,
        companyId: options.companyId,
        userId: options.userId ?? null,
        fingerprint: parsed.fingerprint,
        source: parsed.document?.source ?? null,
        summary: {
            ...EMPTY_SUMMARY,
            recipesInFile: parsed.document?.recipes.length ?? 0,
            linesInFile: parsed.document?.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0) ?? 0,
            productionRecipesInFile: parsed.document?.productionRecipes.length ?? 0,
            productionComponentLines: parsed.document?.productionRecipes.reduce((sum, recipe) => sum + recipe.components.length, 0) ?? 0,
            reviewRequired: parsed.document?.reviewRequired.length ?? 0
        },
        issues: [...parsed.issues],
        recipes: [],
        productionRecipes: [],
        catalog: { products: [], unitsOfMeasure: [] }
    };
}

export class MenuRecipeImportError extends Error {
    constructor(public readonly report: MenuRecipeImportReport) {
        super('La importación de recetas no superó la validación. Revise el reporte.');
        this.name = 'MenuRecipeImportError';
    }
}

/**
 * Strict parser for the normalized hand-off format. It deliberately does not
 * coerce quantities or infer missing identities: every association must remain
 * reviewable before the database is touched.
 */
function parseMenuRecipeSection(input: unknown): ParsedDocumentResult {
    const issues: MenuRecipeImportIssue[] = [];
    const inputFingerprint = fingerprint(input);

    if (!isRecord(input)) {
        issues.push(issue('ERROR', 'DOCUMENT_INVALID', '$', 'El JSON debe ser un objeto.'));
        return { document: null, issues, fingerprint: inputFingerprint };
    }

    if (input.schemaVersion !== 1) {
        issues.push(issue('ERROR', 'SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', 'schemaVersion debe ser 1.'));
    }

    const sourceValue = input.source;
    let source: NormalizedMenuRecipeDocument['source'] | null = null;
    if (!isRecord(sourceValue) || !cleanOptionalString(sourceValue.file)) {
        issues.push(issue('ERROR', 'SOURCE_INVALID', '$.source.file', 'source.file es requerido.'));
    } else {
        source = {
            file: cleanOptionalString(sourceValue.file)!,
            sheet: cleanOptionalString(sourceValue.sheet),
            generatedAt: cleanOptionalString(sourceValue.generatedAt),
            sha256: cleanOptionalString(sourceValue.sha256),
            templateFile: cleanOptionalString(sourceValue.templateFile),
            templateSha256: cleanOptionalString(sourceValue.templateSha256)
        };
    }

    if (!Array.isArray(input.recipes) || input.recipes.length === 0) {
        issues.push(issue('ERROR', 'RECIPES_EMPTY', '$.recipes', 'recipes debe contener al menos una receta.'));
        return { document: null, issues, fingerprint: inputFingerprint };
    }

    const recipes: NormalizedMenuRecipe[] = [];
    const sourceKeys = new Set<string>();

    input.recipes.forEach((rawRecipe, recipeIndex) => {
        const recipePath = `$.recipes[${recipeIndex}]`;
        if (!isRecord(rawRecipe)) {
            issues.push(issue('ERROR', 'RECIPE_INVALID', recipePath, 'La receta debe ser un objeto.'));
            return;
        }

        const rawMenuItem = rawRecipe.menuItem;
        if (!isRecord(rawMenuItem)) {
            issues.push(issue('ERROR', 'MENU_ITEM_REFERENCE_INVALID', `${recipePath}.menuItem`, 'menuItem debe ser un objeto.'));
            return;
        }

        const menuItemName = cleanOptionalString(rawMenuItem.name);
        if (!menuItemName) {
            issues.push(issue('ERROR', 'MENU_ITEM_NAME_REQUIRED', `${recipePath}.menuItem.name`, 'El nombre del plato es requerido.'));
        }

        const code = cleanOptionalString(rawRecipe.code);
        const explicitSourceKey = cleanOptionalString(rawRecipe.sourceKey);
        const sourceRowRaw = rawRecipe.sourceRow;
        const sourceRow = typeof sourceRowRaw === 'number' && Number.isInteger(sourceRowRaw) && sourceRowRaw > 0
            ? sourceRowRaw
            : null;
        if (sourceRowRaw !== undefined && sourceRowRaw !== null && sourceRow === null) {
            issues.push(issue('ERROR', 'SOURCE_ROW_INVALID', `${recipePath}.sourceRow`, 'sourceRow debe ser un entero positivo.'));
        }

        if (!Array.isArray(rawRecipe.ingredients) || rawRecipe.ingredients.length === 0) {
            issues.push(issue('ERROR', 'INGREDIENTS_EMPTY', `${recipePath}.ingredients`, 'La receta debe tener al menos un ingrediente.'));
            return;
        }

        const ingredients: NormalizedRecipeIngredient[] = [];
        rawRecipe.ingredients.forEach((rawIngredient, ingredientIndex) => {
            const ingredientPath = `${recipePath}.ingredients[${ingredientIndex}]`;
            if (!isRecord(rawIngredient)) {
                issues.push(issue('ERROR', 'INGREDIENT_INVALID', ingredientPath, 'El ingrediente debe ser un objeto.'));
                return;
            }

            const name = cleanOptionalString(rawIngredient.name);
            const legacySku = cleanOptionalString(rawIngredient.sku);
            const productSku = cleanOptionalString(rawIngredient.productSku);
            if (legacySku && productSku && normalizeCode(legacySku) !== normalizeCode(productSku)) {
                issues.push(issue('ERROR', 'PRODUCT_SKU_CONFLICT', ingredientPath, `sku (${legacySku}) y productSku (${productSku}) no coinciden.`));
            }
            const sku = productSku ?? legacySku;
            const unit = cleanOptionalString(rawIngredient.unit);
            const quantity = rawIngredient.quantity;
            const ingredientSourceRowRaw = rawIngredient.sourceRow;
            const ingredientSourceRow = typeof ingredientSourceRowRaw === 'number'
                && Number.isInteger(ingredientSourceRowRaw)
                && ingredientSourceRowRaw > 0
                ? ingredientSourceRowRaw
                : null;

            if (!name) issues.push(issue('ERROR', 'INGREDIENT_NAME_REQUIRED', `${ingredientPath}.name`, 'El nombre del ingrediente es requerido.'));
            if (!unit) issues.push(issue('ERROR', 'INGREDIENT_UNIT_REQUIRED', `${ingredientPath}.unit`, 'La unidad del ingrediente es requerida.'));
            if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
                issues.push(issue('ERROR', 'INGREDIENT_QUANTITY_INVALID', `${ingredientPath}.quantity`, 'La cantidad debe ser un número finito mayor que 0.'));
            } else {
                if (quantity > 9_999_999.999) {
                    issues.push(issue('ERROR', 'INGREDIENT_QUANTITY_OVERFLOW', `${ingredientPath}.quantity`, 'La cantidad excede DECIMAL(10,3).'));
                }
                if (decimalPlaces(quantity) > 3) {
                    issues.push(issue('ERROR', 'INGREDIENT_QUANTITY_PRECISION', `${ingredientPath}.quantity`, 'La cantidad admite como máximo 3 decimales.'));
                }
            }
            if (ingredientSourceRowRaw !== undefined && ingredientSourceRowRaw !== null && ingredientSourceRow === null) {
                issues.push(issue('ERROR', 'SOURCE_ROW_INVALID', `${ingredientPath}.sourceRow`, 'sourceRow debe ser un entero positivo.'));
            }

            if (name && unit && typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
                ingredients.push({
                    name,
                    sourceName: cleanOptionalString(rawIngredient.sourceName) ?? name,
                    sku,
                    productSku,
                    unit,
                    quantity,
                    sourceRow: ingredientSourceRow,
                    quantityRaw: rawIngredient.quantityRaw,
                    unitRaw: rawIngredient.unitRaw,
                    source: isRecord(rawIngredient.source) ? rawIngredient.source : null,
                    formulas: isRecord(rawIngredient.formulas) ? rawIngredient.formulas : null
                });
            }
        });

        if (!menuItemName || ingredients.length === 0) return;

        const menuItem: NormalizedMenuItemReference = {
            name: menuItemName,
            category: cleanOptionalString(rawMenuItem.category),
            brand: cleanOptionalString(rawMenuItem.brand),
            branchCode: cleanOptionalString(rawMenuItem.branchCode)
        };
        const sourceKey = explicitSourceKey ?? (code
            ? `code:${normalizeCode(code)}`
            : `menu:${normalizeText(menuItem.name)}|${normalizeText(menuItem.category ?? '')}|${normalizeText(menuItem.brand ?? '')}|${normalizeCode(menuItem.branchCode ?? '')}`);
        if (sourceKeys.has(sourceKey)) {
            issues.push(issue('ERROR', 'RECIPE_DUPLICATE', recipePath, `La receta "${code ?? menuItem.name}" aparece más de una vez en el archivo.`));
        }
        sourceKeys.add(sourceKey);

        recipes.push({
            code,
            sourceKey,
            sourceRow,
            variantQualifier: cleanOptionalString(rawRecipe.variantQualifier),
            menuItem,
            ingredients,
            source: isRecord(rawRecipe.source) ? rawRecipe.source : null
        });
    });

    const document = source
        ? { schemaVersion: 1 as const, source, recipes, productionRecipes: [], reviewRequired: [] }
        : null;

    return { document, issues, fingerprint: inputFingerprint };
}

/** Parse the complete normalized contract (menu + production + review queue). */
export function parseNormalizedMenuRecipes(
    input: unknown,
    options?: { allowReviewRequired?: boolean }
): ParsedDocumentResult {
    const inputFingerprint = fingerprint(input);
    if (!isRecord(input)) {
        return {
            document: null,
            issues: [issue('ERROR', 'DOCUMENT_INVALID', '$', 'El JSON debe ser un objeto.')],
            fingerprint: inputFingerprint
        };
    }

    const rawMenuRecipes = Array.isArray(input.recipes) ? input.recipes : [];
    let base: ParsedDocumentResult;
    if (rawMenuRecipes.length > 0) {
        base = parseMenuRecipeSection(input);
    } else {
        const baseIssues: MenuRecipeImportIssue[] = [];
        if (input.schemaVersion !== 1) {
            baseIssues.push(issue('ERROR', 'SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', 'schemaVersion debe ser 1.'));
        }
        const rawSource = input.source;
        let source: NormalizedMenuRecipeDocument['source'] | null = null;
        if (!isRecord(rawSource) || !cleanOptionalString(rawSource.file)) {
            baseIssues.push(issue('ERROR', 'SOURCE_INVALID', '$.source.file', 'source.file es requerido.'));
        } else {
            source = {
                file: cleanOptionalString(rawSource.file)!,
                sheet: cleanOptionalString(rawSource.sheet),
                generatedAt: cleanOptionalString(rawSource.generatedAt),
                sha256: cleanOptionalString(rawSource.sha256),
                templateFile: cleanOptionalString(rawSource.templateFile),
                templateSha256: cleanOptionalString(rawSource.templateSha256)
            };
        }
        base = {
            document: source
                ? { schemaVersion: 1, source, recipes: [], productionRecipes: [], reviewRequired: [] }
                : null,
            issues: baseIssues,
            fingerprint: inputFingerprint
        };
    }

    const issues = [...base.issues];
    if (!Array.isArray(input.recipes)) {
        issues.push(issue('ERROR', 'MENU_RECIPES_INVALID', '$.recipes', 'recipes debe ser un arreglo.'));
    }
    if (!Array.isArray(input.productionRecipes)) {
        issues.push(issue('ERROR', 'PRODUCTION_RECIPES_INVALID', '$.productionRecipes', 'productionRecipes debe ser un arreglo.'));
    }
    if (!Array.isArray(input.reviewRequired)) {
        issues.push(issue('ERROR', 'REVIEW_REQUIRED_INVALID', '$.reviewRequired', 'reviewRequired debe ser un arreglo.'));
    }

    const rawProductionRecipes = Array.isArray(input.productionRecipes) ? input.productionRecipes : [];
    const reviews = Array.isArray(input.reviewRequired) ? input.reviewRequired : [];
    reviews.forEach((rawReview, reviewIndex) => {
        const context = isRecord(rawReview)
            ? {
                sourceKey: cleanOptionalString(rawReview.sourceKey),
                sourceRow: rawReview.sourceRow ?? null,
                candidateDomain: rawReview.candidateDomain ?? null,
                reasonCodes: rawReview.reasonCodes ?? []
            }
            : undefined;
        issues.push(issue(
            options?.allowReviewRequired ? 'WARNING' : 'ERROR',
            'REVIEW_REQUIRED',
            `$.reviewRequired[${reviewIndex}]`,
            options?.allowReviewRequired
                ? 'Bloque excluido del subconjunto importable mediante autorización explícita; permanece pendiente de revisión humana.'
                : 'Este bloque requiere decisión humana y no puede aplicarse automáticamente.',
            context
        ));
    });

    const productionRecipes: NormalizedProductionRecipe[] = [];
    const productionSourceKeys = new Set<string>();
    rawProductionRecipes.forEach((rawRecipe, recipeIndex) => {
        const recipePath = `$.productionRecipes[${recipeIndex}]`;
        if (!isRecord(rawRecipe)) {
            issues.push(issue('ERROR', 'PRODUCTION_RECIPE_INVALID', recipePath, 'La receta de producción debe ser un objeto.'));
            return;
        }

        const sourceKey = cleanOptionalString(rawRecipe.sourceKey);
        if (!sourceKey) {
            issues.push(issue('ERROR', 'PRODUCTION_SOURCE_KEY_REQUIRED', `${recipePath}.sourceKey`, 'sourceKey es requerido para trazabilidad.'));
        } else if (productionSourceKeys.has(sourceKey)) {
            issues.push(issue('ERROR', 'PRODUCTION_RECIPE_DUPLICATE', recipePath, `sourceKey "${sourceKey}" está duplicado.`));
        } else {
            productionSourceKeys.add(sourceKey);
        }

        const sourceRowRaw = rawRecipe.sourceRow;
        const sourceRow = typeof sourceRowRaw === 'number' && Number.isInteger(sourceRowRaw) && sourceRowRaw > 0
            ? sourceRowRaw
            : null;
        if (sourceRowRaw !== undefined && sourceRowRaw !== null && sourceRow === null) {
            issues.push(issue('ERROR', 'SOURCE_ROW_INVALID', `${recipePath}.sourceRow`, 'sourceRow debe ser un entero positivo.'));
        }

        const rawOutput = rawRecipe.output;
        if (!isRecord(rawOutput)) {
            issues.push(issue('ERROR', 'PRODUCTION_OUTPUT_INVALID', `${recipePath}.output`, 'output debe ser un objeto.'));
            return;
        }
        const outputName = cleanOptionalString(rawOutput.name);
        if (!outputName) {
            issues.push(issue('ERROR', 'PRODUCTION_OUTPUT_NAME_REQUIRED', `${recipePath}.output.name`, 'El nombre del producto de salida es requerido.'));
        }
        const outputLegacySku = cleanOptionalString(rawOutput.sku);
        const outputProductSku = cleanOptionalString(rawOutput.productSku);
        if (outputLegacySku && outputProductSku && normalizeCode(outputLegacySku) !== normalizeCode(outputProductSku)) {
            issues.push(issue('ERROR', 'PRODUCT_SKU_CONFLICT', `${recipePath}.output`, `sku (${outputLegacySku}) y productSku (${outputProductSku}) no coinciden.`));
        }

        const status = rawRecipe.status;
        if (status !== 'DRAFT' && status !== 'ACTIVE') {
            issues.push(issue('ERROR', 'PRODUCTION_STATUS_INVALID', `${recipePath}.status`, 'status debe ser DRAFT o ACTIVE.'));
        }

        const rawYield = rawRecipe.yield;
        if (!isRecord(rawYield)) {
            issues.push(issue('ERROR', 'PRODUCTION_YIELD_INVALID', `${recipePath}.yield`, 'yield debe ser un objeto.'));
            return;
        }
        const yieldUnit = cleanOptionalString(rawYield.unit);
        const yieldQuantity = rawYield.quantity;
        if (!yieldUnit) {
            issues.push(issue('ERROR', 'PRODUCTION_YIELD_UNIT_REQUIRED', `${recipePath}.yield.unit`, 'La unidad de rendimiento es requerida.'));
        }
        if (typeof yieldQuantity !== 'number' || !Number.isFinite(yieldQuantity) || yieldQuantity <= 0) {
            issues.push(issue('ERROR', 'PRODUCTION_YIELD_QUANTITY_INVALID', `${recipePath}.yield.quantity`, 'El rendimiento debe ser un número finito mayor que 0.'));
        } else {
            if (yieldQuantity > 999_999_999_999) {
                issues.push(issue('ERROR', 'PRODUCTION_YIELD_QUANTITY_OVERFLOW', `${recipePath}.yield.quantity`, 'El rendimiento excede DECIMAL(18,6).'));
            }
            if (decimalPlaces(yieldQuantity) > 6) {
                issues.push(issue('ERROR', 'PRODUCTION_YIELD_QUANTITY_PRECISION', `${recipePath}.yield.quantity`, 'El rendimiento admite como máximo 6 decimales.'));
            }
        }

        if (!Array.isArray(rawRecipe.components) || rawRecipe.components.length === 0) {
            issues.push(issue('ERROR', 'PRODUCTION_COMPONENTS_EMPTY', `${recipePath}.components`, 'La receta de producción debe tener al menos un componente.'));
            return;
        }
        const components: NormalizedRecipeIngredient[] = [];
        rawRecipe.components.forEach((rawComponent, componentIndex) => {
            const componentPath = `${recipePath}.components[${componentIndex}]`;
            if (!isRecord(rawComponent)) {
                issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_INVALID', componentPath, 'El componente debe ser un objeto.'));
                return;
            }
            const name = cleanOptionalString(rawComponent.name);
            const unit = cleanOptionalString(rawComponent.unit);
            const quantity = rawComponent.quantity;
            const legacySku = cleanOptionalString(rawComponent.sku);
            const productSku = cleanOptionalString(rawComponent.productSku);
            if (legacySku && productSku && normalizeCode(legacySku) !== normalizeCode(productSku)) {
                issues.push(issue('ERROR', 'PRODUCT_SKU_CONFLICT', componentPath, `sku (${legacySku}) y productSku (${productSku}) no coinciden.`));
            }
            const componentSourceRowRaw = rawComponent.sourceRow;
            const componentSourceRow = typeof componentSourceRowRaw === 'number'
                && Number.isInteger(componentSourceRowRaw)
                && componentSourceRowRaw > 0
                ? componentSourceRowRaw
                : null;
            if (!name) issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_NAME_REQUIRED', `${componentPath}.name`, 'El nombre del componente es requerido.'));
            if (!unit) issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_UNIT_REQUIRED', `${componentPath}.unit`, 'La unidad del componente es requerida.'));
            if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
                issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_QUANTITY_INVALID', `${componentPath}.quantity`, 'La cantidad debe ser finita y mayor que 0.'));
            } else {
                if (quantity > 999_999_999_999) {
                    issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_QUANTITY_OVERFLOW', `${componentPath}.quantity`, 'La cantidad excede DECIMAL(18,6).'));
                }
                if (decimalPlaces(quantity) > 6) {
                    issues.push(issue('ERROR', 'PRODUCTION_COMPONENT_QUANTITY_PRECISION', `${componentPath}.quantity`, 'La cantidad admite como máximo 6 decimales.'));
                }
            }
            if (componentSourceRowRaw !== undefined && componentSourceRowRaw !== null && componentSourceRow === null) {
                issues.push(issue('ERROR', 'SOURCE_ROW_INVALID', `${componentPath}.sourceRow`, 'sourceRow debe ser un entero positivo.'));
            }
            if (name && unit && typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
                components.push({
                    name,
                    sourceName: cleanOptionalString(rawComponent.sourceName) ?? name,
                    sku: productSku ?? legacySku,
                    productSku,
                    quantity,
                    unit,
                    sourceRow: componentSourceRow,
                    quantityRaw: rawComponent.quantityRaw,
                    unitRaw: rawComponent.unitRaw,
                    source: isRecord(rawComponent.source) ? rawComponent.source : null,
                    formulas: isRecord(rawComponent.formulas) ? rawComponent.formulas : null
                });
            }
        });

        if (!sourceKey || !outputName || (status !== 'DRAFT' && status !== 'ACTIVE') || !yieldUnit
            || typeof yieldQuantity !== 'number' || !Number.isFinite(yieldQuantity) || yieldQuantity <= 0
            || components.length !== rawRecipe.components.length) return;

        productionRecipes.push({
            sourceKey,
            sourceRow,
            name: cleanOptionalString(rawRecipe.name),
            status,
            output: {
                name: outputName,
                sourceName: cleanOptionalString(rawOutput.sourceName) ?? outputName,
                sku: outputProductSku ?? outputLegacySku,
                productSku: outputProductSku
            },
            yield: { quantity: yieldQuantity, unit: yieldUnit },
            components,
            source: isRecord(rawRecipe.source) ? rawRecipe.source : null
        });
    });

    if (rawMenuRecipes.length === 0 && rawProductionRecipes.length === 0 && reviews.length === 0) {
        issues.push(issue('ERROR', 'IMPORT_EMPTY', '$', 'El documento no contiene recetas importables ni bloques por revisar.'));
    }

    if (isRecord(input.counts)) {
        const declaredCounts = input.counts;
        const menuLines = rawMenuRecipes.reduce(
            (sum, recipe) => sum + (isRecord(recipe) && Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0),
            0
        );
        const productionLines = rawProductionRecipes.reduce(
            (sum, recipe) => sum + (isRecord(recipe) && Array.isArray(recipe.components) ? recipe.components.length : 0),
            0
        );
        const countChecks: Array<[string, number]> = [
            ['menuRecipes', rawMenuRecipes.length],
            ['menuIngredientLines', menuLines],
            ['productionRecipes', rawProductionRecipes.length],
            ['productionComponentLines', productionLines],
            ['reviewRequired', reviews.length]
        ];
        countChecks.forEach(([field, actual]) => {
            const declared = declaredCounts[field];
            if (typeof declared !== 'number' || declared !== actual) {
                issues.push(issue('ERROR', 'COUNT_MISMATCH', `$.counts.${field}`, `El conteo declarado (${String(declared)}) no coincide con el contenido (${actual}).`));
            }
        });
    }

    const document = base.document
        ? {
            ...base.document,
            productionRecipes,
            reviewRequired: reviews
        }
        : null;
    return { document, issues, fingerprint: inputFingerprint };
}

export class MenuRecipeImportService {
    static async listValidAuditUsers(companyId: number, db: ImportDb = prisma) {
        return db.user.findMany({
            where: { companyId, status: 'ACTIVE' },
            select: { id: true, name: true },
            orderBy: { id: 'asc' }
        });
    }

    private static findMenuItemCandidates(
        reference: NormalizedMenuItemReference,
        menuItems: MenuItemCatalogRow[]
    ): MenuItemCatalogRow[] {
        return menuItems.filter((candidate) => {
            if (normalizeText(candidate.name) !== normalizeText(reference.name)) return false;
            if (reference.category && normalizeText(candidate.category.name) !== normalizeText(reference.category)) return false;
            if (reference.brand && normalizeText(candidate.brand?.name ?? '') !== normalizeText(reference.brand)) return false;
            if (reference.branchCode && normalizeCode(candidate.branch?.code ?? '') !== normalizeCode(reference.branchCode)) return false;
            return true;
        });
    }

    private static findProductCandidates(
        ingredient: NormalizedRecipeIngredient,
        products: ProductCatalogRow[]
    ): ProductCatalogRow[] {
        if (ingredient.sku) {
            return products.filter((candidate) => normalizeCode(candidate.sku ?? '') === normalizeCode(ingredient.sku!));
        }
        return products.filter((candidate) => normalizeText(candidate.name) === normalizeText(ingredient.name));
    }

    private static resolveUnit(rawUnit: string, units: UnitCatalogRow[]): UnitCatalogRow[] {
        const literal = normalizeText(rawUnit).replace(/[.\s_-]+/g, '');
        const requested = normalizeUnitKey(rawUnit);
        const exact = units.filter((candidate) => normalizeText(candidate.abbreviation).replace(/[.\s_-]+/g, '') === literal);
        const activeExact = exact.filter((candidate) => candidate.active);
        if (activeExact.length > 0) return activeExact;
        const aliases = units.filter((candidate) => normalizeUnitKey(candidate.abbreviation) === requested);
        const activeAliases = aliases.filter((candidate) => candidate.active);
        if (activeAliases.length > 0) return activeAliases;
        if (exact.length > 0) return exact;
        if (aliases.length > 0) return aliases;
        const names = units.filter((candidate) => normalizeText(candidate.name).replace(/\s+/g, '') === requested);
        const activeNames = names.filter((candidate) => candidate.active);
        return activeNames.length > 0 ? activeNames : names;
    }

    static async plan(
        document: NormalizedMenuRecipeDocument,
        options: { companyId: number; userId?: number | null; dryRun?: boolean; replace?: boolean; fingerprint?: string },
        db: ImportDb = prisma
    ): Promise<MenuRecipeImportReport> {
        const issues: MenuRecipeImportIssue[] = [];
        const summary: MenuRecipeImportSummary = {
            ...EMPTY_SUMMARY,
            recipesInFile: document.recipes.length,
            linesInFile: document.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0)
        };
        const report: MenuRecipeImportReport = {
            valid: false,
            applied: false,
            dryRun: options.dryRun !== false,
            replace: options.replace === true,
            allowReviewRequired: false,
            skipProductionRecipes: false,
            companyId: options.companyId,
            userId: options.userId ?? null,
            fingerprint: options.fingerprint ?? fingerprint(document),
            source: document.source,
            summary,
            issues,
            recipes: [],
            productionRecipes: [],
            catalog: { products: [], unitsOfMeasure: [] }
        };

        if (!Number.isInteger(options.companyId) || options.companyId <= 0) {
            issues.push(issue('ERROR', 'COMPANY_ID_INVALID', '$options.companyId', 'companyId debe ser un entero positivo.'));
            return report;
        }

        const company = await db.company.findFirst({
            where: { id: options.companyId, active: true },
            select: { id: true, name: true }
        });
        if (!company) {
            issues.push(issue('ERROR', 'COMPANY_NOT_FOUND', '$options.companyId', `No existe una empresa activa con id ${options.companyId}.`));
            return report;
        }

        if (options.dryRun === false) {
            const validUsers = await this.listValidAuditUsers(options.companyId, db);
            if (!options.userId) {
                issues.push(issue(
                    'ERROR',
                    'AUDIT_USER_REQUIRED',
                    '$options.userId',
                    'userId es requerido al aplicar para registrar la auditoría.',
                    { validUsers }
                ));
                return report;
            }
            const actor = validUsers.find((candidate) => candidate.id === options.userId);
            if (!actor) {
                issues.push(issue(
                    'ERROR',
                    'AUDIT_USER_INVALID',
                    '$options.userId',
                    `El usuario ${options.userId} no está activo o no pertenece a la empresa ${options.companyId}.`,
                    { validUsers }
                ));
                return report;
            }
        }

        const [menuItems, products, units] = await Promise.all([
            db.menuItem.findMany({
                where: { companyId: options.companyId },
                select: {
                    id: true,
                    name: true,
                    active: true,
                    category: { select: { name: true } },
                    brand: { select: { name: true } },
                    branch: { select: { code: true } }
                }
            }) as unknown as Promise<MenuItemCatalogRow[]>,
            db.product.findMany({
                where: { companyId: options.companyId },
                select: { id: true, name: true, sku: true, unit: true, type: true, baseUnitId: true, active: true }
            }) as unknown as Promise<ProductCatalogRow[]>,
            db.unitOfMeasure.findMany({
                where: { companyId: options.companyId },
                select: { id: true, name: true, abbreviation: true, active: true }
            }) as unknown as Promise<UnitCatalogRow[]>
        ]);
        report.catalog = {
            products: [...products].sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id),
            unitsOfMeasure: [...units].sort((left, right) => left.id - right.id)
        };

        const resolvedTargets: Array<{ recipe: NormalizedMenuRecipe; menuItem: MenuItemCatalogRow; sourceIndex: number }> = [];
        const targetedMenuItemIds = new Map<number, number>();

        document.recipes.forEach((recipe, sourceIndex) => {
            const path = `$.recipes[${sourceIndex}].menuItem`;
            const candidates = this.findMenuItemCandidates(recipe.menuItem, menuItems);
            if (candidates.length === 0) {
                issues.push(issue(
                    'ERROR',
                    'MENU_ITEM_NOT_FOUND',
                    path,
                    `No se encontró el plato "${recipe.menuItem.name}" con los calificadores indicados.`,
                    { reference: recipe.menuItem }
                ));
                return;
            }
            if (candidates.length > 1) {
                issues.push(issue(
                    'ERROR',
                    'MENU_ITEM_AMBIGUOUS',
                    path,
                    `El plato "${recipe.menuItem.name}" coincide con ${candidates.length} registros. Agregue category, brand o branchCode.`,
                    {
                        candidates: candidates.map((candidate) => ({
                            id: candidate.id,
                            name: candidate.name,
                            category: candidate.category.name,
                            brand: candidate.brand?.name ?? null,
                            branchCode: candidate.branch?.code ?? null
                        }))
                    }
                ));
                return;
            }

            const menuItem = candidates[0];
            const previousSourceIndex = targetedMenuItemIds.get(menuItem.id);
            if (previousSourceIndex !== undefined) {
                issues.push(issue(
                    'ERROR',
                    'MENU_ITEM_TARGET_DUPLICATE',
                    path,
                    `Dos recetas del archivo resuelven al mismo MenuItem id=${menuItem.id}.`,
                    { previousPath: `$.recipes[${previousSourceIndex}]` }
                ));
                return;
            }
            targetedMenuItemIds.set(menuItem.id, sourceIndex);
            if (!menuItem.active) {
                issues.push(issue('WARNING', 'MENU_ITEM_INACTIVE', path, `El plato "${menuItem.name}" está inactivo; la receta se importará pero no se venderá mientras siga inactivo.`));
            }
            resolvedTargets.push({ recipe, menuItem, sourceIndex });
        });

        const existingRecipes = targetedMenuItemIds.size > 0
            ? await db.recipe.findMany({
                where: { menuItemId: { in: [...targetedMenuItemIds.keys()] } },
                include: { product: { select: { id: true, name: true, sku: true } } }
            }) as unknown as ExistingRecipeRow[]
            : [];
        const existingByMenuItem = new Map<number, ExistingRecipeRow[]>();
        existingRecipes.forEach((row) => {
            const rows = existingByMenuItem.get(row.menuItemId) ?? [];
            rows.push(row);
            existingByMenuItem.set(row.menuItemId, rows);
        });
        // Unit compatibility depends on product + unit configuration, not on the
        // recipe quantity. Cache it across the 81 lines so a dry-run or
        // postcondition does not execute the same catalog query dozens of times.
        const conversionChecks = new Map<string, Promise<string | null>>();

        for (const target of resolvedTargets) {
            const planned: PlannedMenuRecipe = {
                sourceKey: target.recipe.sourceKey ?? null,
                sourceCode: target.recipe.code ?? null,
                sourceRow: target.recipe.sourceRow ?? null,
                variantQualifier: target.recipe.variantQualifier ?? null,
                menuItemId: target.menuItem.id,
                menuItemName: target.menuItem.name,
                category: target.menuItem.category.name,
                brand: target.menuItem.brand?.name ?? null,
                branchCode: target.menuItem.branch?.code ?? null,
                lines: [],
                deletions: []
            };
            report.recipes.push(planned);
            const existingForItem = existingByMenuItem.get(target.menuItem.id) ?? [];
            const existingByProduct = new Map(existingForItem.map((row) => [row.productId, row]));
            const resolvedProductIds = new Map<number, number>();

            for (let ingredientIndex = 0; ingredientIndex < target.recipe.ingredients.length; ingredientIndex++) {
                const ingredient = target.recipe.ingredients[ingredientIndex];
                const ingredientPath = `$.recipes[${target.sourceIndex}].ingredients[${ingredientIndex}]`;
                const productCandidates = this.findProductCandidates(ingredient, products);

                if (productCandidates.length === 0) {
                    issues.push(issue(
                        'ERROR',
                        'PRODUCT_NOT_FOUND',
                        ingredientPath,
                        ingredient.sku
                            ? `No se encontró el producto SKU "${ingredient.sku}" en la empresa.`
                            : `No se encontró un producto con nombre exacto "${ingredient.name}" en la empresa. Agregue el SKU para resolverlo explícitamente.`,
                        {
                            name: ingredient.name,
                            sku: ingredient.sku ?? null,
                            suggestions: suggestProducts({ name: ingredient.name, sku: ingredient.sku }, products)
                        }
                    ));
                    continue;
                }
                if (productCandidates.length > 1) {
                    issues.push(issue(
                        'ERROR',
                        'PRODUCT_AMBIGUOUS',
                        ingredientPath,
                        `El ingrediente "${ingredient.name}" coincide con ${productCandidates.length} productos. Indique un SKU exacto.`,
                        { candidates: productCandidates.map((candidate) => ({ id: candidate.id, sku: candidate.sku, name: candidate.name })) }
                    ));
                    continue;
                }

                const product = productCandidates[0];
                if (!product.active) {
                    issues.push(issue('ERROR', 'PRODUCT_INACTIVE', ingredientPath, `El producto ${product.sku ?? product.id} (${product.name}) está inactivo.`));
                    continue;
                }
                if (ingredient.sku && normalizeText(product.name) !== normalizeText(ingredient.name)) {
                    issues.push(issue(
                        'WARNING',
                        'PRODUCT_NAME_DIFFERS_FROM_CATALOG',
                        ingredientPath,
                        `El nombre fuente "${ingredient.name}" difiere de "${product.name}"; se usará el SKU exacto y auditable "${ingredient.sku}".`,
                        { productId: product.id, productSku: product.sku, sourceName: ingredient.name, catalogName: product.name }
                    ));
                }

                const previousIngredientIndex = resolvedProductIds.get(product.id);
                if (previousIngredientIndex !== undefined) {
                    issues.push(issue(
                        'ERROR',
                        'PRODUCT_DUPLICATE_IN_RECIPE',
                        ingredientPath,
                        `El producto ${product.sku ?? product.id} aparece más de una vez en la misma receta; Recipe solo admite una línea por producto. Consolide las cantidades explícitamente.`,
                        { previousPath: `$.recipes[${target.sourceIndex}].ingredients[${previousIngredientIndex}]` }
                    ));
                    continue;
                }
                resolvedProductIds.set(product.id, ingredientIndex);

                const unitCandidates = this.resolveUnit(ingredient.unit, units);
                if (unitCandidates.length === 0) {
                    issues.push(issue(
                        'ERROR',
                        'UNIT_NOT_FOUND',
                        `${ingredientPath}.unit`,
                        `No existe la unidad "${ingredient.unit}" en el catálogo de la empresa.`,
                        { availableAbbreviations: units.filter((unit) => unit.active).map((unit) => unit.abbreviation) }
                    ));
                    continue;
                }
                if (unitCandidates.length > 1) {
                    issues.push(issue(
                        'ERROR',
                        'UNIT_AMBIGUOUS',
                        `${ingredientPath}.unit`,
                        `La unidad "${ingredient.unit}" coincide con más de un registro.`,
                        { candidates: unitCandidates.map((unit) => ({ id: unit.id, name: unit.name, abbreviation: unit.abbreviation })) }
                    ));
                    continue;
                }
                const unit = unitCandidates[0];
                if (!unit.active) {
                    issues.push(issue('ERROR', 'UNIT_INACTIVE', `${ingredientPath}.unit`, `La unidad "${unit.abbreviation}" está inactiva.`));
                    continue;
                }

                const conversionKey = `${product.id}:${normalizeUnitKey(unit.abbreviation)}`;
                let conversionCheck = conversionChecks.get(conversionKey);
                if (!conversionCheck) {
                    conversionCheck = UnitConversionService.convert(
                        product.id,
                        options.companyId,
                        1,
                        unit.abbreviation,
                        db as Prisma.TransactionClient
                    ).then(() => null).catch((error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        if (/transaction already closed|expired transaction/i.test(message)) throw error;
                        return message || 'La unidad no es compatible con el producto.';
                    });
                    conversionChecks.set(conversionKey, conversionCheck);
                }
                const conversionError = await conversionCheck;
                if (conversionError) {
                    issues.push(issue(
                        'ERROR',
                        'UNIT_INCOMPATIBLE',
                        `${ingredientPath}.unit`,
                        conversionError,
                        { productId: product.id, productSku: product.sku, unitId: unit.id, unit: unit.abbreviation }
                    ));
                    continue;
                }

                const existing = existingByProduct.get(product.id);
                let action: PlannedLineAction = 'CREATE';
                if (existing) {
                    action = sameQuantity(Number(existing.quantity), ingredient.quantity)
                        && existing.unitId === unit.id
                        && normalizeUnitKey(existing.unit ?? '') === normalizeUnitKey(unit.abbreviation)
                        ? 'UNCHANGED'
                        : 'UPDATE';
                }
                planned.lines.push({
                    action,
                    existingRecipeId: existing?.id ?? null,
                    productId: product.id,
                    productSku: product.sku,
                    productName: product.name,
                    sourceName: ingredient.sourceName ?? ingredient.name,
                    quantity: ingredient.quantity,
                    unitId: unit.id,
                    unit: unit.abbreviation,
                    sourceRow: ingredient.sourceRow ?? null
                });
                if (action === 'CREATE') summary.creates++;
                else if (action === 'UPDATE') summary.updates++;
                else summary.unchanged++;
            }

            const obsolete = existingForItem.filter((row) => !resolvedProductIds.has(row.productId));
            if (options.replace) {
                planned.deletions = obsolete.map((row) => ({
                    recipeId: row.id,
                    productId: row.productId,
                    productSku: row.product.sku,
                    productName: row.product.name,
                    quantity: Number(row.quantity),
                    unitId: row.unitId,
                    unit: row.unit
                }));
                summary.deletes += planned.deletions.length;
            } else {
                summary.preserved += obsolete.length;
            }
        }

        summary.recipesResolved = report.recipes.length;
        report.valid = !issues.some((entry) => entry.severity === 'ERROR')
            && report.recipes.length === document.recipes.length;
        return report;
    }

    private static async planAll(
        document: NormalizedMenuRecipeDocument,
        options: { companyId: number; userId?: number | null; dryRun?: boolean; replace?: boolean; skipProductionRecipes?: boolean; fingerprint?: string },
        db: ImportDb
    ): Promise<MenuRecipeImportReport> {
        const report = await this.plan(document, options, db);
        const cannotResolveTenant = report.issues.some((entry) => entry.code === 'COMPANY_ID_INVALID' || entry.code === 'COMPANY_NOT_FOUND');
        if (cannotResolveTenant) return report;

        report.skipProductionRecipes = options.skipProductionRecipes === true;
        if (report.skipProductionRecipes) {
            Object.assign(report.summary, {
                productionRecipesInFile: document.productionRecipes.length,
                productionRecipesResolved: 0,
                productionComponentLines: document.productionRecipes.reduce((sum, recipe) => sum + recipe.components.length, 0),
                productionVersionsCreated: 0,
                productionRecipesUnchanged: 0,
                productionRecipesDeactivated: 0,
                reviewRequired: document.reviewRequired.length
            });
            document.productionRecipes.forEach((recipe, index) => {
                report.issues.push(issue(
                    'WARNING',
                    'PRODUCTION_RECIPE_SKIPPED',
                    `$.productionRecipes[${index}]`,
                    'Receta productiva excluida mediante autorización explícita; permanece DRAFT en el archivo normalizado hasta resolver catálogo y conversiones.',
                    { sourceKey: recipe.sourceKey, outputName: recipe.output.name }
                ));
            });
            report.valid = report.valid && !report.issues.some((entry) => entry.severity === 'ERROR');
            return report;
        }

        const productionPlan = await ProductionRecipeImportService.plan(
            document.productionRecipes,
            options.companyId,
            db
        );
        report.productionRecipes = productionPlan.recipes;
        report.issues.push(...productionPlan.issues);
        Object.assign(report.summary, productionPlan.summary, {
            reviewRequired: document.reviewRequired.length
        });
        report.valid = report.valid
            && productionPlan.valid
            && report.productionRecipes.length === document.productionRecipes.length
            && !report.issues.some((entry) => entry.severity === 'ERROR');
        return report;
    }

    private static async applyPlan(
        tx: Prisma.TransactionClient,
        report: MenuRecipeImportReport,
        userId: number
    ): Promise<void> {
        const creates: Prisma.RecipeCreateManyInput[] = [];
        const updates: Array<{
            menuItemId: number;
            productId: number;
            quantity: number;
            unit: string;
            unitId: number;
        }> = [];
        const deletionIds: number[] = [];
        const audits: Prisma.AuditLogCreateManyInput[] = [];

        for (const recipe of report.recipes) {
            const changedLines = recipe.lines.filter((line) => line.action !== 'UNCHANGED');
            for (const line of changedLines) {
                if (line.action === 'CREATE') {
                    creates.push({
                        menuItemId: recipe.menuItemId,
                        productId: line.productId,
                        quantity: line.quantity,
                        unit: line.unit,
                        unitId: line.unitId
                    });
                } else {
                    updates.push({
                        menuItemId: recipe.menuItemId,
                        productId: line.productId,
                        quantity: line.quantity,
                        unit: line.unit,
                        unitId: line.unitId
                    });
                }
            }
            deletionIds.push(...recipe.deletions.map((line) => line.recipeId));

            if (changedLines.length > 0 || recipe.deletions.length > 0) {
                audits.push({
                    companyId: report.companyId,
                    userId,
                    entityType: 'MenuItemRecipe',
                    entityId: recipe.menuItemId,
                    action: 'IMPORT',
                    details: {
                        source: report.source,
                        sourceFingerprint: report.fingerprint,
                        replace: report.replace,
                        allowReviewRequired: report.allowReviewRequired,
                        skipProductionRecipes: report.skipProductionRecipes,
                        reviewRequiredExcluded: report.summary.reviewRequired,
                        sourceCode: recipe.sourceCode,
                        sourceKey: recipe.sourceKey,
                        sourceRow: recipe.sourceRow,
                        variantQualifier: recipe.variantQualifier,
                        menuItemName: recipe.menuItemName,
                        created: changedLines.filter((line) => line.action === 'CREATE').map((line) => line.productId),
                        updated: changedLines.filter((line) => line.action === 'UPDATE').map((line) => line.productId),
                        deleted: recipe.deletions.map((line) => line.productId),
                        mappings: changedLines.map((line) => ({
                            action: line.action,
                            sourceName: line.sourceName,
                            productId: line.productId,
                            productSku: line.productSku,
                            catalogName: line.productName,
                            quantity: line.quantity,
                            unit: line.unit,
                            sourceRow: line.sourceRow
                        }))
                    } as Prisma.InputJsonValue
                });
            }
        }

        if (deletionIds.length > 0) await tx.recipe.deleteMany({ where: { id: { in: deletionIds } } });
        if (creates.length > 0) await tx.recipe.createMany({ data: creates });
        for (const update of updates) {
            await tx.recipe.update({
                where: {
                    menuItemId_productId: {
                        menuItemId: update.menuItemId,
                        productId: update.productId
                    }
                },
                data: { quantity: update.quantity, unit: update.unit, unitId: update.unitId }
            });
        }
        if (audits.length > 0) await tx.auditLog.createMany({ data: audits });
    }

    static async importDocument(input: unknown, options: MenuRecipeImportOptions): Promise<MenuRecipeImportReport> {
        const parsed = parseNormalizedMenuRecipes(input, {
            allowReviewRequired: options.allowReviewRequired === true
        });
        const baseReport = emptyReport(options, parsed);
        if (!parsed.document || parsed.issues.some((entry) => entry.severity === 'ERROR')) {
            return baseReport;
        }

        const client = options.client ?? prisma;
        const dryRun = options.dryRun !== false;

        if (dryRun) {
            const report = await this.planAll(parsed.document, {
                companyId: options.companyId,
                userId: options.userId,
                dryRun: true,
                replace: options.replace,
                skipProductionRecipes: options.skipProductionRecipes,
                fingerprint: parsed.fingerprint
            }, client);
            report.allowReviewRequired = options.allowReviewRequired === true;
            report.skipProductionRecipes = options.skipProductionRecipes === true;
            report.issues.unshift(...parsed.issues);
            report.valid = !report.issues.some((entry) => entry.severity === 'ERROR');
            return report;
        }

        return client.$transaction(async (tx) => {
            const report = await this.planAll(parsed.document!, {
                companyId: options.companyId,
                userId: options.userId,
                dryRun: false,
                replace: options.replace,
                skipProductionRecipes: options.skipProductionRecipes,
                fingerprint: parsed.fingerprint
            }, tx);
            report.allowReviewRequired = options.allowReviewRequired === true;
            report.skipProductionRecipes = options.skipProductionRecipes === true;
            report.issues.unshift(...parsed.issues);
            report.valid = !report.issues.some((entry) => entry.severity === 'ERROR')
                && report.recipes.length === parsed.document!.recipes.length
                && (report.skipProductionRecipes || report.productionRecipes.length === parsed.document!.productionRecipes.length);
            if (!report.valid || !options.userId) throw new MenuRecipeImportError(report);

            await this.applyPlan(tx, report, options.userId);
            if (!report.skipProductionRecipes) await ProductionRecipeImportService.applyPlan(tx, {
                valid: true,
                issues: report.issues,
                recipes: report.productionRecipes,
                summary: {
                    productionRecipesInFile: report.summary.productionRecipesInFile,
                    productionRecipesResolved: report.summary.productionRecipesResolved,
                    productionComponentLines: report.summary.productionComponentLines,
                    productionVersionsCreated: report.summary.productionVersionsCreated,
                    productionRecipesUnchanged: report.summary.productionRecipesUnchanged,
                    productionRecipesDeactivated: report.summary.productionRecipesDeactivated
                }
            }, {
                companyId: report.companyId,
                userId: options.userId,
                fingerprint: report.fingerprint,
                source: report.source,
                allowReviewRequired: report.allowReviewRequired,
                reviewRequiredExcluded: report.summary.reviewRequired
            });

            // Postcondition inside the same transaction: a second plan must be a
            // no-op. This protects the one-time production import from a partially
            // applied or non-idempotent result.
            const verification = await this.planAll(parsed.document!, {
                companyId: options.companyId,
                userId: options.userId,
                dryRun: false,
                replace: options.replace,
                skipProductionRecipes: options.skipProductionRecipes,
                fingerprint: parsed.fingerprint
            }, tx);
            verification.allowReviewRequired = options.allowReviewRequired === true;
            verification.skipProductionRecipes = options.skipProductionRecipes === true;
            if (!verification.valid
                || verification.summary.creates > 0
                || verification.summary.updates > 0
                || verification.summary.deletes > 0
                || verification.summary.productionVersionsCreated > 0
                || verification.summary.productionRecipesDeactivated > 0) {
                verification.issues.push(issue(
                    'ERROR',
                    'POSTCONDITION_FAILED',
                    '$',
                    'La verificación posterior detectó cambios pendientes; se revirtió toda la transacción.'
                ));
                verification.valid = false;
                throw new MenuRecipeImportError(verification);
            }

            report.applied = true;
            return report;
        }, {
            isolationLevel: 'Serializable',
            maxWait: 10_000,
            timeout: 180_000
        });
    }
}
