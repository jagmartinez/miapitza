import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import type {
    MenuRecipeImportIssue,
    NormalizedMenuRecipe,
    NormalizedMenuRecipeDocument,
    NormalizedRecipeIngredient
} from '../services/menu-recipe-import.service';
import { parseNormalizedMenuRecipes } from '../services/menu-recipe-import.service';
import type { NormalizedProductionRecipe } from '../services/production-recipe-import.service';

type ReviewStatus = 'RESOLVED' | 'BLOCKED' | 'IGNORED';
type CandidateDomain = 'MENU' | 'PRODUCTION' | 'BUNDLE' | 'PORTIONING' | 'DIRECT';

type ReviewIngredientMapping = {
    sourceRow: number;
    productSku: string;
    catalogName: string;
    resolvedQuantity?: number;
    resolvedUnit?: string;
};

type ReviewMenuTarget = {
    kind: 'MENU';
    name: string;
    category: string;
    brand: string | null;
    type: 'PREPARED' | 'DIRECT';
    price: number;
    description: string;
};

type ReviewProductionTarget = {
    kind: 'PRODUCTION';
    outputSku: string;
    outputName: string;
    yieldQuantity: number;
    yieldUnit: string;
    recipeStatus: 'DRAFT';
};

type ReviewDecision = {
    sourceKey: string;
    candidateDomain: CandidateDomain;
    status: ReviewStatus;
    target?: ReviewMenuTarget | ReviewProductionTarget;
    ingredients?: ReviewIngredientMapping[];
    evidence: string[];
    decisionRequired?: string | null;
};

export type ReviewResolutionMap = {
    schemaVersion: 1;
    source: { file: string; sha256: string };
    status: string;
    policies: Record<string, boolean>;
    decisions: ReviewDecision[];
};

type ReviewBlock = {
    sourceKey: string;
    sourceRow?: number | null;
    candidateDomain: CandidateDomain;
    reasonCodes?: string[];
    variantQualifier?: string | null;
    data: {
        name: string;
        sourceName?: string | null;
        yield?: { quantity: number | null; unit: string | null };
        ingredients: Array<NormalizedRecipeIngredient & {
            sourceName?: string | null;
            sourceRow?: number | null;
            quantity: number | null;
            unit: string | null;
        }>;
        source?: Record<string, unknown> | null;
    };
};

export type ReviewedMenuItemDefinition = {
    sourceKey: string;
    name: string;
    category: string;
    brand: string | null;
    type: 'PREPARED' | 'DIRECT';
    price: number;
    description: string;
};

export type ReviewedRecipePreparation = {
    valid: boolean;
    fingerprint: string;
    summary: {
        reviewBlocks: number;
        decisions: number;
        resolved: number;
        blocked: number;
        ignored: number;
        menuRecipes: number;
        menuRecipeLines: number;
        productionRecipes: number;
        productionComponentLines: number;
    };
    issues: MenuRecipeImportIssue[];
    menuItems: ReviewedMenuItemDefinition[];
    document: NormalizedMenuRecipeDocument;
    pending: Array<{
        sourceKey: string;
        candidateDomain: CandidateDomain;
        status: 'BLOCKED' | 'IGNORED';
        reasonCodes: string[];
        decisionRequired: string | null;
        evidence: string[];
    }>;
};

const DEFAULT_NORMALIZED = path.resolve(__dirname, '../../prisma/data/recetas-menu.normalized.json');
const DEFAULT_MAP = path.resolve(__dirname, '../../prisma/data/recetas-menu.review-map.json');

function clean(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function issue(
    severity: 'ERROR' | 'WARNING',
    code: string,
    issuePath: string,
    message: string,
    context?: Record<string, unknown>
): MenuRecipeImportIssue {
    return { severity, code, path: issuePath, message, ...(context ? { context } : {}) };
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function isReviewBlock(value: unknown): value is ReviewBlock {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    return Boolean(clean(record.sourceKey)
        && clean(record.candidateDomain)
        && data
        && clean(data.name)
        && Array.isArray(data.ingredients));
}

function resolvedIngredients(
    block: ReviewBlock,
    decision: ReviewDecision,
    decisionIndex: number,
    issues: MenuRecipeImportIssue[]
): NormalizedRecipeIngredient[] {
    const result: NormalizedRecipeIngredient[] = [];
    const mappings = Array.isArray(decision.ingredients) ? decision.ingredients : [];
    const byRow = new Map<number, ReviewIngredientMapping>();
    mappings.forEach((mapping, mappingIndex) => {
        const mappingPath = `$.decisions[${decisionIndex}].ingredients[${mappingIndex}]`;
        if (!Number.isInteger(mapping.sourceRow) || mapping.sourceRow <= 0) {
            issues.push(issue('ERROR', 'REVIEW_MAPPING_ROW_INVALID', `${mappingPath}.sourceRow`, 'sourceRow debe ser entero positivo.'));
            return;
        }
        if (byRow.has(mapping.sourceRow)) {
            issues.push(issue('ERROR', 'REVIEW_MAPPING_ROW_DUPLICATE', mappingPath, `Fila ${mapping.sourceRow} duplicada.`));
            return;
        }
        byRow.set(mapping.sourceRow, mapping);
    });

    for (let sourceIndex = 0; sourceIndex < block.data.ingredients.length; sourceIndex++) {
        const source = block.data.ingredients[sourceIndex];
        const componentPath = `$.reviewRequired[${block.sourceKey}].ingredients[${sourceIndex}]`;
        const sourceRow = source.sourceRow;
        if (!sourceRow || !Number.isInteger(sourceRow)) {
            issues.push(issue('ERROR', 'REVIEW_SOURCE_ROW_REQUIRED', `${componentPath}.sourceRow`, 'La línea fuente requiere sourceRow.'));
            continue;
        }
        const mapping = byRow.get(sourceRow);
        if (!mapping) {
            issues.push(issue('ERROR', 'REVIEW_MAPPING_MISSING', componentPath, `Falta resolver la fila ${sourceRow}.`));
            continue;
        }
        const quantity = mapping.resolvedQuantity ?? source.quantity;
        const unit = mapping.resolvedUnit ?? source.unit;
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
            issues.push(issue('ERROR', 'REVIEW_RESOLVED_QUANTITY_INVALID', componentPath, 'La cantidad resuelta debe ser mayor que cero.'));
            continue;
        }
        if (!clean(unit)) {
            issues.push(issue('ERROR', 'REVIEW_RESOLVED_UNIT_INVALID', componentPath, 'La unidad resuelta es obligatoria.'));
            continue;
        }
        if (!clean(mapping.productSku) || !clean(mapping.catalogName)) {
            issues.push(issue('ERROR', 'REVIEW_PRODUCT_MAPPING_INCOMPLETE', componentPath, 'Cada línea requiere productSku y catalogName.'));
            continue;
        }

        result.push({
            ...source,
            name: mapping.catalogName,
            sourceName: source.sourceName ?? source.name,
            sku: mapping.productSku,
            productSku: mapping.productSku,
            quantity,
            unit: unit!,
            sourceRow
        });
        byRow.delete(sourceRow);
    }

    if (byRow.size > 0) {
        issues.push(issue(
            'ERROR',
            'REVIEW_MAPPING_EXTRA',
            `$.decisions[${decisionIndex}].ingredients`,
            `El mapa contiene filas que no están en la fuente: ${[...byRow.keys()].join(', ')}.`
        ));
    }
    return result;
}

export function prepareReviewedRecipes(
    sourceDocument: NormalizedMenuRecipeDocument,
    map: ReviewResolutionMap,
    fingerprint = sha256(JSON.stringify({ reviewRequired: sourceDocument.reviewRequired, map }))
): ReviewedRecipePreparation {
    const issues: MenuRecipeImportIssue[] = [];
    const menuItems: ReviewedMenuItemDefinition[] = [];
    const recipes: NormalizedMenuRecipe[] = [];
    const productionRecipes: NormalizedProductionRecipe[] = [];
    const pending: ReviewedRecipePreparation['pending'] = [];
    const blocks = sourceDocument.reviewRequired.filter(isReviewBlock);

    if (blocks.length !== sourceDocument.reviewRequired.length) {
        issues.push(issue('ERROR', 'REVIEW_SOURCE_CONTRACT_INVALID', '$.reviewRequired', 'Hay bloques reviewRequired con estructura inválida.'));
    }
    if (map.schemaVersion !== 1) {
        issues.push(issue('ERROR', 'REVIEW_MAP_VERSION_UNSUPPORTED', '$map.schemaVersion', 'schemaVersion debe ser 1.'));
    }
    if (map.source.sha256 !== sourceDocument.source.sha256) {
        issues.push(issue('ERROR', 'REVIEW_MAP_SOURCE_MISMATCH', '$map.source.sha256', 'El mapa no corresponde al SHA-256 del Excel normalizado.'));
    }
    const requiredPolicies = [
        'neverInventMissingQuantityOrUnit',
        'publishedMenuPriceOverridesConflictingLocalCell',
        'duplicateZeroPriceIsIgnored',
        'resolvedRecipesRemainAuditableToSourceRows',
        'newProductionRecipesStartDraft'
    ];
    for (const policy of requiredPolicies) {
        if (map.policies?.[policy] !== true) {
            issues.push(issue('ERROR', 'REVIEW_SAFETY_POLICY_DISABLED', `$.map.policies.${policy}`, `La política ${policy} debe permanecer activa.`));
        }
    }

    const decisions = new Map<string, { decision: ReviewDecision; index: number }>();
    map.decisions.forEach((decision, index) => {
        if (!clean(decision.sourceKey)) {
            issues.push(issue('ERROR', 'REVIEW_DECISION_KEY_REQUIRED', `$.decisions[${index}].sourceKey`, 'sourceKey es obligatorio.'));
            return;
        }
        if (decisions.has(decision.sourceKey)) {
            issues.push(issue('ERROR', 'REVIEW_DECISION_DUPLICATE', `$.decisions[${index}].sourceKey`, `${decision.sourceKey} está duplicado.`));
            return;
        }
        decisions.set(decision.sourceKey, { decision, index });
    });

    const sourceKeys = new Set(blocks.map((block) => block.sourceKey));
    for (const key of decisions.keys()) {
        if (!sourceKeys.has(key)) issues.push(issue('ERROR', 'REVIEW_DECISION_EXTRA', '$.decisions', `El mapa contiene un bloque inexistente: ${key}.`));
    }

    for (const block of blocks) {
        const mapped = decisions.get(block.sourceKey);
        if (!mapped) {
            issues.push(issue('ERROR', 'REVIEW_DECISION_MISSING', '$.decisions', `Falta una decisión para ${block.sourceKey}.`));
            continue;
        }
        const { decision, index } = mapped;
        if (decision.candidateDomain !== block.candidateDomain) {
            issues.push(issue('ERROR', 'REVIEW_DOMAIN_STALE', `$.decisions[${index}].candidateDomain`, 'candidateDomain no coincide con la fuente.', {
                source: block.candidateDomain,
                mapped: decision.candidateDomain
            }));
        }
        if (!Array.isArray(decision.evidence) || decision.evidence.length === 0) {
            issues.push(issue('ERROR', 'REVIEW_EVIDENCE_REQUIRED', `$.decisions[${index}].evidence`, 'Toda decisión requiere evidencia.'));
        }

        if (decision.status === 'BLOCKED' || decision.status === 'IGNORED') {
            if (decision.status === 'BLOCKED' && !clean(decision.decisionRequired)) {
                issues.push(issue('ERROR', 'REVIEW_BLOCKED_DECISION_REQUIRED', `$.decisions[${index}].decisionRequired`, 'Un bloqueo requiere la decisión pendiente.'));
            }
            pending.push({
                sourceKey: block.sourceKey,
                candidateDomain: block.candidateDomain,
                status: decision.status,
                reasonCodes: block.reasonCodes ?? [],
                decisionRequired: decision.decisionRequired ?? null,
                evidence: decision.evidence
            });
            continue;
        }

        if (decision.status !== 'RESOLVED' || !decision.target) {
            issues.push(issue('ERROR', 'REVIEW_RESOLVED_TARGET_REQUIRED', `$.decisions[${index}].target`, 'Una decisión RESOLVED requiere target.'));
            continue;
        }
        const ingredients = resolvedIngredients(block, decision, index, issues);
        if (ingredients.length !== block.data.ingredients.length) continue;

        if (decision.target.kind === 'MENU') {
            const target = decision.target;
            if (!clean(target.name) || !clean(target.category) || !Number.isFinite(target.price) || target.price <= 0) {
                issues.push(issue('ERROR', 'REVIEW_MENU_TARGET_INVALID', `$.decisions[${index}].target`, 'Menú requiere nombre, categoría y precio mayor que cero.'));
                continue;
            }
            if (!['MENU', 'PORTIONING', 'DIRECT'].includes(block.candidateDomain)) {
                issues.push(issue('ERROR', 'REVIEW_MENU_DOMAIN_INVALID', `$.decisions[${index}].target.kind`, `${block.candidateDomain} no puede resolver a MENU.`));
                continue;
            }
            menuItems.push({
                sourceKey: block.sourceKey,
                name: target.name,
                category: target.category,
                brand: target.brand,
                type: target.type,
                price: target.price,
                description: target.description
            });
            recipes.push({
                sourceKey: block.sourceKey,
                sourceRow: block.sourceRow ?? null,
                variantQualifier: block.variantQualifier ?? null,
                menuItem: {
                    name: target.name,
                    category: target.category,
                    brand: target.brand
                },
                ingredients,
                source: block.data.source ?? null
            });
        } else {
            const target = decision.target;
            if (block.candidateDomain !== 'PRODUCTION') {
                issues.push(issue('ERROR', 'REVIEW_PRODUCTION_DOMAIN_INVALID', `$.decisions[${index}].target.kind`, `${block.candidateDomain} no puede resolver a PRODUCTION.`));
                continue;
            }
            if (!clean(target.outputSku)
                || !clean(target.outputName)
                || !Number.isFinite(target.yieldQuantity)
                || target.yieldQuantity <= 0
                || !clean(target.yieldUnit)
                || target.recipeStatus !== 'DRAFT') {
                issues.push(issue('ERROR', 'REVIEW_PRODUCTION_TARGET_INVALID', `$.decisions[${index}].target`, 'Producción requiere salida, rendimiento positivo y estado DRAFT.'));
                continue;
            }
            productionRecipes.push({
                sourceKey: block.sourceKey,
                sourceRow: block.sourceRow ?? null,
                name: `Receta de ${target.outputName}`,
                status: 'DRAFT',
                output: {
                    name: target.outputName,
                    sourceName: block.data.sourceName ?? block.data.name,
                    sku: target.outputSku,
                    productSku: target.outputSku
                },
                yield: { quantity: target.yieldQuantity, unit: target.yieldUnit },
                components: ingredients,
                source: block.data.source ?? null
            });
        }
    }

    const resolvedCount = recipes.length + productionRecipes.length;
    const blockedCount = pending.filter((item) => item.status === 'BLOCKED').length;
    const ignoredCount = pending.filter((item) => item.status === 'IGNORED').length;
    const summary = {
        reviewBlocks: blocks.length,
        decisions: map.decisions.length,
        resolved: resolvedCount,
        blocked: blockedCount,
        ignored: ignoredCount,
        menuRecipes: recipes.length,
        menuRecipeLines: recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0),
        productionRecipes: productionRecipes.length,
        productionComponentLines: productionRecipes.reduce((sum, recipe) => sum + recipe.components.length, 0)
    };
    if (summary.resolved + summary.blocked + summary.ignored !== summary.reviewBlocks) {
        issues.push(issue('ERROR', 'REVIEW_SCOPE_MISMATCH', '$', 'Las decisiones no cubren exactamente los 35 bloques.', summary));
    }
    const menuNames = menuItems.map((item) => item.name.toLocaleLowerCase('es'));
    if (new Set(menuNames).size !== menuNames.length) {
        issues.push(issue('ERROR', 'REVIEW_MENU_NAME_DUPLICATE', '$.decisions', 'Dos resoluciones crean el mismo nombre de menú.'));
    }

    return {
        valid: !issues.some((entry) => entry.severity === 'ERROR'),
        fingerprint,
        summary,
        issues,
        menuItems,
        document: {
            schemaVersion: 1,
            source: {
                ...sourceDocument.source,
                sheet: 'reviewRequired resuelto',
                generatedAt: new Date(0).toISOString()
            },
            recipes,
            productionRecipes,
            reviewRequired: []
        },
        pending
    };
}

type CliOptions = {
    normalized: string;
    map: string;
    outDocument: string | null;
    outMenuItems: string | null;
    outReport: string | null;
};

function readArg(args: string[], flag: string): string | null {
    const index = args.indexOf(flag);
    if (index < 0) return null;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return value;
}

function parseArgs(args: string[]): CliOptions {
    return {
        normalized: path.resolve(readArg(args, '--normalized') ?? DEFAULT_NORMALIZED),
        map: path.resolve(readArg(args, '--map') ?? DEFAULT_MAP),
        outDocument: readArg(args, '--out-document') ? path.resolve(readArg(args, '--out-document')!) : null,
        outMenuItems: readArg(args, '--out-menu-items') ? path.resolve(readArg(args, '--out-menu-items')!) : null,
        outReport: readArg(args, '--report') ? path.resolve(readArg(args, '--report')!) : null
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const [normalizedRaw, mapRaw] = await Promise.all([
        readFile(options.normalized, 'utf8'),
        readFile(options.map, 'utf8')
    ]);
    const parsed = parseNormalizedMenuRecipes(JSON.parse(normalizedRaw), { allowReviewRequired: true });
    if (!parsed.document || parsed.issues.some((entry) => entry.severity === 'ERROR')) {
        throw new Error(`Contrato fuente inválido: ${parsed.issues.map((entry) => entry.code).join(', ')}`);
    }
    const resolution = prepareReviewedRecipes(
        parsed.document,
        JSON.parse(mapRaw) as ReviewResolutionMap,
        sha256(`${normalizedRaw}\n${mapRaw}`)
    );
    if (options.outDocument) await writeFile(options.outDocument, `${JSON.stringify(resolution.document, null, 2)}\n`, 'utf8');
    if (options.outMenuItems) await writeFile(options.outMenuItems, `${JSON.stringify({
        schemaVersion: 1,
        source: resolution.document.source,
        fingerprint: resolution.fingerprint,
        menuItems: resolution.menuItems
    }, null, 2)}\n`, 'utf8');
    if (options.outReport) await writeFile(options.outReport, `${JSON.stringify({
        valid: resolution.valid,
        fingerprint: resolution.fingerprint,
        summary: resolution.summary,
        issues: resolution.issues,
        pending: resolution.pending
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        valid: resolution.valid,
        fingerprint: resolution.fingerprint,
        summary: resolution.summary,
        issues: resolution.issues,
        pending: resolution.pending,
        document: resolution.document,
        menuItems: resolution.menuItems
    }, null, 2)}\n`);
    if (!resolution.valid) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`Error preparando revisión: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
