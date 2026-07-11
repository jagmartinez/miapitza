import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';

import prisma from '../utils/prisma';
import {
    MenuRecipeImportIssue,
    NormalizedMenuRecipeDocument,
    parseNormalizedMenuRecipes
} from '../services/menu-recipe-import.service';
import {
    NormalizedProductionRecipe,
    ProductionRecipeImportPlan,
    ProductionRecipeImportService
} from '../services/production-recipe-import.service';

type ResolutionStatus = 'RESOLVED' | 'BLOCKED';

type ResolvedMapping = {
    status: 'RESOLVED';
    productSku: string;
    catalogName: string;
};

type BlockedMapping = {
    status: 'BLOCKED';
    candidates?: unknown[];
};

type ResolutionMapping = ResolvedMapping | BlockedMapping;

export interface ProductionComponentResolution {
    sourceRow: number;
    sourceName: string;
    quantity: number;
    unit: string;
    status: ResolutionStatus;
    mapping: ResolutionMapping;
    unitResolution: {
        status: ResolutionStatus;
        strategy: string | null;
        catalogBaseUnit: string | null;
        /**
         * Optional, evidence-backed correction applied to the importable
         * contract. The top-level quantity/unit remain an immutable copy of
         * the workbook source so stale-map detection still protects us.
         */
        resolvedQuantity?: number;
        resolvedUnit?: string;
    };
    reasonCodes: string[];
    evidence: string[];
    decisionRequired: string | null;
    alternatives: string[];
}

export interface ProductionRecipeResolution {
    sourceKey: string;
    output: {
        status: ResolutionStatus;
        mapping: ResolutionMapping;
        reasonCodes: string[];
        evidence: string[];
        decisionRequired: string | null;
        alternatives: string[];
    };
    yield: {
        status: ResolutionStatus;
        quantity: number;
        unit: string;
        reasonCodes: string[];
        evidence: string[];
        decisionRequired: string | null;
    };
    components: ProductionComponentResolution[];
}

export interface ProductionResolutionMap {
    schemaVersion: 1;
    source: {
        file: string;
        sha256: string;
        normalizedContract: string;
    };
    status: string;
    policies: {
        initialRecipeStatus: 'DRAFT';
        applyRequiresAllRecipesReady: boolean;
        blockedMappingsAreNeverApplied: boolean;
        crossDimensionConversionsRequireBusinessEvidence: boolean;
        inferredYieldsRequireConfirmation: boolean;
    };
    recipes: ProductionRecipeResolution[];
}

export interface ProductionBlockedDecision {
    sourceKey: string;
    scope: 'OUTPUT' | 'YIELD' | 'COMPONENT';
    sourceRow: number | null;
    sourceName: string;
    reasonCodes: string[];
    decisionRequired: string;
    evidence: string[];
    alternatives: string[];
}

export interface ProductionPreparationReport {
    contractValid: boolean;
    readyToApply: boolean;
    applied: boolean;
    fingerprint: string;
    source: NormalizedMenuRecipeDocument['source'] | null;
    summary: {
        sourceRecipes: number;
        sourceComponents: number;
        mappedRecipes: number;
        readyRecipes: number;
        blockedRecipes: number;
        resolvedComponents: number;
        blockedComponents: number;
        resolvedOutputs: number;
        blockedOutputs: number;
        resolvedYields: number;
        blockedYields: number;
    };
    issues: MenuRecipeImportIssue[];
    blockedDecisions: ProductionBlockedDecision[];
    readyRecipes: NormalizedProductionRecipe[];
    databasePlan: ProductionRecipeImportPlan | null;
}

type CliOptions = {
    normalizedFile: string;
    mapFile: string;
    reportFile: string | null;
    companyId: number | null;
    userId: number | null;
    apply: boolean;
    help: boolean;
};

const DEFAULT_NORMALIZED_FILE = path.resolve(__dirname, '../../prisma/data/recetas-menu.normalized.json');
const DEFAULT_MAP_FILE = path.resolve(__dirname, '../../prisma/data/recetas-menu.production-map.json');

const HELP = `
Prepara e importa de forma estricta las recetas de producción de Recetas Menu.xlsx.

Uso:
  node dist/scripts/prepare-production-recipes.js [opciones]

Opciones:
  --normalized <ruta>  Contrato normalizado (default: prisma/data/recetas-menu.normalized.json)
  --map <ruta>         Matriz de decisiones (default: prisma/data/recetas-menu.production-map.json)
  --company-id <id>    Valida el plan contra el catálogo de la empresa
  --user-id <id>       Usuario activo de auditoría; obligatorio con --apply
  --dry-run            Prepara y valida sin escribir (comportamiento por defecto)
  --apply              Aplica sólo si las 8 recetas y 42 componentes están RESOLVED
  --report <ruta>      Guarda el reporte JSON
  --help               Muestra esta ayuda

Garantías:
  - un mapeo BLOCKED nunca se copia al contrato aplicable;
  - --apply exige que todo el alcance esté listo, no importa subconjuntos silenciosos;
  - el plan se vuelve a calcular dentro de la misma transacción y debe quedar sin cambios;
  - se rechazan ciclos, unidades incompatibles y rendimientos no confirmados.
`;

function issue(
    severity: 'ERROR' | 'WARNING',
    code: string,
    pathValue: string,
    message: string,
    context?: Record<string, unknown>
): MenuRecipeImportIssue {
    return { severity, code, path: pathValue, message, ...(context ? { context } : {}) };
}

function normalizeText(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('es')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function normalizeUnit(value: string): string {
    const key = normalizeText(value).replace(/[.\s_-]+/g, '');
    const aliases: Record<string, string> = {
        gr: 'g',
        grs: 'g',
        gramos: 'g',
        lbs: 'lb',
        libras: 'lb',
        lt: 'l',
        litros: 'l',
        und: 'unidad',
        unidades: 'unidad'
    };
    return aliases[key] ?? key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function emptySummary(sourceRecipes: NormalizedProductionRecipe[]) {
    return {
        sourceRecipes: sourceRecipes.length,
        sourceComponents: sourceRecipes.reduce((sum, recipe) => sum + recipe.components.length, 0),
        mappedRecipes: 0,
        readyRecipes: 0,
        blockedRecipes: 0,
        resolvedComponents: 0,
        blockedComponents: 0,
        resolvedOutputs: 0,
        blockedOutputs: 0,
        resolvedYields: 0,
        blockedYields: 0
    };
}

function blockedDecision(
    recipe: ProductionRecipeResolution,
    scope: ProductionBlockedDecision['scope'],
    values: {
        sourceRow?: number | null;
        sourceName: string;
        reasonCodes: string[];
        decisionRequired: string | null;
        evidence: string[];
        alternatives?: string[];
    }
): ProductionBlockedDecision {
    return {
        sourceKey: recipe.sourceKey,
        scope,
        sourceRow: values.sourceRow ?? null,
        sourceName: values.sourceName,
        reasonCodes: values.reasonCodes,
        decisionRequired: values.decisionRequired ?? 'Falta una decisión explícita.',
        evidence: values.evidence,
        alternatives: values.alternatives ?? []
    };
}

function validateResolvedMapping(
    mapping: ResolutionMapping,
    pathValue: string,
    issues: MenuRecipeImportIssue[]
): mapping is ResolvedMapping {
    if (mapping.status !== 'RESOLVED') {
        issues.push(issue('ERROR', 'RESOLVED_ITEM_WITHOUT_MAPPING', pathValue, 'Un elemento RESOLVED requiere mapping.status=RESOLVED.'));
        return false;
    }
    if (!mapping.productSku?.trim() || !mapping.catalogName?.trim()) {
        issues.push(issue('ERROR', 'RESOLVED_MAPPING_INCOMPLETE', pathValue, 'Un mapeo RESOLVED requiere productSku y catalogName.'));
        return false;
    }
    return true;
}

function validateBlockedMetadata(
    reasonCodes: string[],
    decisionRequired: string | null,
    pathValue: string,
    issues: MenuRecipeImportIssue[]
): void {
    if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
        issues.push(issue('ERROR', 'BLOCKED_REASON_REQUIRED', `${pathValue}.reasonCodes`, 'Un bloqueo requiere al menos un reasonCode.'));
    }
    if (!decisionRequired?.trim()) {
        issues.push(issue('ERROR', 'BLOCKED_DECISION_REQUIRED', `${pathValue}.decisionRequired`, 'Un bloqueo requiere una decisión de negocio explícita.'));
    }
}

/** Detect cycles in a directed SKU graph. Each returned path repeats its first SKU at the end. */
export function detectProductionCycles(recipes: NormalizedProductionRecipe[]): string[][] {
    const outputs = new Set(
        recipes
            .map((recipe) => recipe.output.productSku ?? recipe.output.sku ?? '')
            .filter(Boolean)
    );
    const graph = new Map<string, string[]>();
    for (const recipe of recipes) {
        const outputSku = recipe.output.productSku ?? recipe.output.sku;
        if (!outputSku) continue;
        const dependencies = recipe.components
            .map((component) => component.productSku ?? component.sku ?? '')
            .filter((componentSku) => outputs.has(componentSku));
        graph.set(outputSku, dependencies);
    }

    const state = new Map<string, 'VISITING' | 'DONE'>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const signatures = new Set<string>();

    const visit = (sku: string): void => {
        if (state.get(sku) === 'DONE') return;
        if (state.get(sku) === 'VISITING') {
            const position = stack.indexOf(sku);
            const cycle = [...stack.slice(position), sku];
            const nodes = cycle.slice(0, -1);
            const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join('>'));
            const signature = rotations.sort()[0];
            if (!signatures.has(signature)) {
                signatures.add(signature);
                cycles.push(cycle);
            }
            return;
        }

        state.set(sku, 'VISITING');
        stack.push(sku);
        for (const dependency of graph.get(sku) ?? []) visit(dependency);
        stack.pop();
        state.set(sku, 'DONE');
    };

    for (const sku of graph.keys()) visit(sku);
    return cycles;
}

/**
 * Reconciles the immutable normalized source with the explicit decision map.
 * Only complete recipes are emitted in readyRecipes, so blocked candidates can
 * never leak into a database plan.
 */
export function prepareProductionRecipes(
    document: NormalizedMenuRecipeDocument,
    resolutionMap: ProductionResolutionMap,
    fingerprint = sha256(JSON.stringify({ document: document.productionRecipes, resolutionMap }))
): ProductionPreparationReport {
    const sourceRecipes = document.productionRecipes;
    const issues: MenuRecipeImportIssue[] = [];
    const blockedDecisions: ProductionBlockedDecision[] = [];
    const readyRecipes: NormalizedProductionRecipe[] = [];
    const summary = emptySummary(sourceRecipes);

    if (resolutionMap.schemaVersion !== 1) {
        issues.push(issue('ERROR', 'PRODUCTION_MAP_VERSION_UNSUPPORTED', '$map.schemaVersion', 'schemaVersion debe ser 1.'));
    }
    if (resolutionMap.source.sha256 !== document.source.sha256) {
        issues.push(issue(
            'ERROR',
            'PRODUCTION_MAP_SOURCE_MISMATCH',
            '$map.source.sha256',
            'El mapa no corresponde al SHA-256 del archivo fuente normalizado.',
            { expected: document.source.sha256, actual: resolutionMap.source.sha256 }
        ));
    }
    if (resolutionMap.policies.initialRecipeStatus !== 'DRAFT') {
        issues.push(issue('ERROR', 'PRODUCTION_INITIAL_STATUS_UNSAFE', '$map.policies.initialRecipeStatus', 'La primera importación debe permanecer DRAFT.'));
    }
    if (!resolutionMap.policies.applyRequiresAllRecipesReady || !resolutionMap.policies.blockedMappingsAreNeverApplied) {
        issues.push(issue('ERROR', 'PRODUCTION_MAP_SAFETY_POLICY_DISABLED', '$map.policies', 'No se pueden desactivar las políticas de alcance completo y mapeos bloqueados.'));
    }

    const sourceByKey = new Map(sourceRecipes.map((recipe) => [recipe.sourceKey, recipe]));
    const mapByKey = new Map<string, ProductionRecipeResolution>();
    resolutionMap.recipes.forEach((recipe, index) => {
        if (mapByKey.has(recipe.sourceKey)) {
            issues.push(issue('ERROR', 'PRODUCTION_MAP_RECIPE_DUPLICATE', `$.map.recipes[${index}].sourceKey`, `sourceKey duplicado: ${recipe.sourceKey}.`));
        }
        mapByKey.set(recipe.sourceKey, recipe);
    });

    for (const mappedRecipe of resolutionMap.recipes) {
        if (!sourceByKey.has(mappedRecipe.sourceKey)) {
            issues.push(issue('ERROR', 'PRODUCTION_MAP_RECIPE_EXTRA', '$map.recipes', `El mapa contiene una receta inexistente: ${mappedRecipe.sourceKey}.`));
        }
    }

    sourceRecipes.forEach((sourceRecipe, recipeIndex) => {
        const recipePath = `$.productionRecipes[${recipeIndex}]`;
        const mappedRecipe = mapByKey.get(sourceRecipe.sourceKey);
        if (!mappedRecipe) {
            issues.push(issue('ERROR', 'PRODUCTION_MAP_RECIPE_MISSING', recipePath, `Falta ${sourceRecipe.sourceKey} en el mapa.`));
            return;
        }
        summary.mappedRecipes++;

        let recipeReady = true;
        let resolvedOutput: ResolvedMapping | null = null;
        if (mappedRecipe.output.status === 'RESOLVED') {
            summary.resolvedOutputs++;
            if (validateResolvedMapping(mappedRecipe.output.mapping, `${recipePath}.output.mapping`, issues)) {
                resolvedOutput = mappedRecipe.output.mapping;
            } else {
                recipeReady = false;
            }
        } else {
            summary.blockedOutputs++;
            recipeReady = false;
            validateBlockedMetadata(mappedRecipe.output.reasonCodes, mappedRecipe.output.decisionRequired, `${recipePath}.output`, issues);
            blockedDecisions.push(blockedDecision(mappedRecipe, 'OUTPUT', {
                sourceName: sourceRecipe.output.sourceName ?? sourceRecipe.output.name,
                reasonCodes: mappedRecipe.output.reasonCodes,
                decisionRequired: mappedRecipe.output.decisionRequired,
                evidence: mappedRecipe.output.evidence,
                alternatives: mappedRecipe.output.alternatives
            }));
        }

        if (!Number.isFinite(mappedRecipe.yield.quantity)
            || mappedRecipe.yield.quantity <= 0
            || Math.abs(mappedRecipe.yield.quantity - sourceRecipe.yield.quantity) > 1e-9
            || normalizeUnit(mappedRecipe.yield.unit) !== normalizeUnit(sourceRecipe.yield.unit)) {
            issues.push(issue(
                'ERROR',
                'PRODUCTION_MAP_YIELD_STALE',
                `${recipePath}.yield`,
                'Cantidad/unidad de rendimiento del mapa no coincide con la fuente normalizada.',
                { source: sourceRecipe.yield, mapped: mappedRecipe.yield }
            ));
            recipeReady = false;
        }
        if (mappedRecipe.yield.status === 'RESOLVED') {
            summary.resolvedYields++;
        } else {
            summary.blockedYields++;
            recipeReady = false;
            validateBlockedMetadata(mappedRecipe.yield.reasonCodes, mappedRecipe.yield.decisionRequired, `${recipePath}.yield`, issues);
            blockedDecisions.push(blockedDecision(mappedRecipe, 'YIELD', {
                sourceName: sourceRecipe.output.sourceName ?? sourceRecipe.output.name,
                reasonCodes: mappedRecipe.yield.reasonCodes,
                decisionRequired: mappedRecipe.yield.decisionRequired,
                evidence: mappedRecipe.yield.evidence
            }));
        }

        const sourceComponentsByRow = new Map<number, NormalizedProductionRecipe['components'][number]>();
        sourceRecipe.components.forEach((component, componentIndex) => {
            const row = component.sourceRow;
            if (!row) {
                issues.push(issue('ERROR', 'PRODUCTION_SOURCE_ROW_REQUIRED', `${recipePath}.components[${componentIndex}].sourceRow`, 'Cada componente requiere sourceRow para reconciliar el mapa.'));
                return;
            }
            if (sourceComponentsByRow.has(row)) {
                issues.push(issue('ERROR', 'PRODUCTION_SOURCE_ROW_DUPLICATE', `${recipePath}.components[${componentIndex}].sourceRow`, `Fila fuente duplicada: ${row}.`));
            }
            sourceComponentsByRow.set(row, component);
        });

        const mappedComponentsByRow = new Map<number, ProductionComponentResolution>();
        mappedRecipe.components.forEach((component, componentIndex) => {
            if (mappedComponentsByRow.has(component.sourceRow)) {
                issues.push(issue('ERROR', 'PRODUCTION_MAP_COMPONENT_DUPLICATE', `${recipePath}.map.components[${componentIndex}].sourceRow`, `Fila mapeada duplicada: ${component.sourceRow}.`));
            }
            mappedComponentsByRow.set(component.sourceRow, component);
            if (!sourceComponentsByRow.has(component.sourceRow)) {
                issues.push(issue('ERROR', 'PRODUCTION_MAP_COMPONENT_EXTRA', `${recipePath}.map.components[${componentIndex}]`, `La fila ${component.sourceRow} no existe en la receta fuente.`));
            }
        });

        const resolvedComponents: NormalizedProductionRecipe['components'] = [];
        sourceRecipe.components.forEach((sourceComponent, componentIndex) => {
            const componentPath = `${recipePath}.components[${componentIndex}]`;
            const sourceRow = sourceComponent.sourceRow!;
            const mappedComponent = mappedComponentsByRow.get(sourceRow);
            if (!mappedComponent) {
                issues.push(issue('ERROR', 'PRODUCTION_MAP_COMPONENT_MISSING', componentPath, `Falta la fila ${sourceRow} en el mapa.`));
                recipeReady = false;
                return;
            }

            const stale = normalizeText(mappedComponent.sourceName) !== normalizeText(sourceComponent.sourceName ?? sourceComponent.name)
                || Math.abs(mappedComponent.quantity - sourceComponent.quantity) > 1e-9
                || normalizeUnit(mappedComponent.unit) !== normalizeUnit(sourceComponent.unit);
            if (stale) {
                issues.push(issue(
                    'ERROR',
                    'PRODUCTION_MAP_COMPONENT_STALE',
                    componentPath,
                    'Nombre, cantidad o unidad del mapa no coincide con la fuente.',
                    { source: sourceComponent, mapped: mappedComponent }
                ));
                recipeReady = false;
            }

            if (mappedComponent.status === 'RESOLVED') {
                summary.resolvedComponents++;
                let resolvedMapping: ResolvedMapping | null = null;
                if (validateResolvedMapping(mappedComponent.mapping, `${componentPath}.mapping`, issues)) {
                    resolvedMapping = mappedComponent.mapping;
                }
                if (mappedComponent.unitResolution.status !== 'RESOLVED') {
                    issues.push(issue('ERROR', 'RESOLVED_COMPONENT_UNIT_BLOCKED', `${componentPath}.unitResolution`, 'Un componente RESOLVED requiere unidad RESOLVED.'));
                    recipeReady = false;
                }
                if (resolvedMapping && mappedComponent.unitResolution.status === 'RESOLVED') {
                    const resolvedQuantity = mappedComponent.unitResolution.resolvedQuantity
                        ?? sourceComponent.quantity;
                    const resolvedUnit = mappedComponent.unitResolution.resolvedUnit
                        ?? sourceComponent.unit;
                    const hasCorrection = mappedComponent.unitResolution.resolvedQuantity !== undefined
                        || mappedComponent.unitResolution.resolvedUnit !== undefined;
                    if (!Number.isFinite(resolvedQuantity) || resolvedQuantity <= 0) {
                        issues.push(issue(
                            'ERROR',
                            'PRODUCTION_COMPONENT_RESOLVED_QUANTITY_INVALID',
                            `${componentPath}.unitResolution.resolvedQuantity`,
                            'La cantidad corregida debe ser mayor que cero.'
                        ));
                        recipeReady = false;
                    }
                    if (!resolvedUnit.trim()) {
                        issues.push(issue(
                            'ERROR',
                            'PRODUCTION_COMPONENT_RESOLVED_UNIT_INVALID',
                            `${componentPath}.unitResolution.resolvedUnit`,
                            'La unidad corregida no puede estar vacía.'
                        ));
                        recipeReady = false;
                    }
                    if (hasCorrection
                        && (!mappedComponent.unitResolution.strategy?.trim()
                            || mappedComponent.evidence.length === 0)) {
                        issues.push(issue(
                            'ERROR',
                            'PRODUCTION_COMPONENT_CORRECTION_EVIDENCE_REQUIRED',
                            `${componentPath}.unitResolution`,
                            'Una corrección de cantidad/unidad requiere estrategia y evidencia explícitas.'
                        ));
                        recipeReady = false;
                    }
                    resolvedComponents.push({
                        ...sourceComponent,
                        name: resolvedMapping.catalogName,
                        sourceName: sourceComponent.sourceName ?? sourceComponent.name,
                        sku: resolvedMapping.productSku,
                        productSku: resolvedMapping.productSku,
                        quantity: resolvedQuantity,
                        unit: resolvedUnit
                    });
                }
            } else {
                summary.blockedComponents++;
                recipeReady = false;
                validateBlockedMetadata(mappedComponent.reasonCodes, mappedComponent.decisionRequired, componentPath, issues);
                blockedDecisions.push(blockedDecision(mappedRecipe, 'COMPONENT', {
                    sourceRow,
                    sourceName: sourceComponent.sourceName ?? sourceComponent.name,
                    reasonCodes: mappedComponent.reasonCodes,
                    decisionRequired: mappedComponent.decisionRequired,
                    evidence: mappedComponent.evidence,
                    alternatives: mappedComponent.alternatives
                }));
            }
        });

        if (recipeReady && resolvedOutput && resolvedComponents.length === sourceRecipe.components.length) {
            readyRecipes.push({
                ...sourceRecipe,
                status: 'DRAFT',
                output: {
                    ...sourceRecipe.output,
                    name: resolvedOutput.catalogName,
                    sourceName: sourceRecipe.output.sourceName ?? sourceRecipe.output.name,
                    sku: resolvedOutput.productSku,
                    productSku: resolvedOutput.productSku
                },
                yield: {
                    quantity: mappedRecipe.yield.quantity,
                    unit: mappedRecipe.yield.unit
                },
                components: resolvedComponents
            });
        }
    });

    summary.readyRecipes = readyRecipes.length;
    summary.blockedRecipes = sourceRecipes.length - readyRecipes.length;

    for (const cycle of detectProductionCycles(readyRecipes)) {
        issues.push(issue(
            'ERROR',
            'PRODUCTION_SOURCE_CYCLE',
            '$.productionRecipes',
            `Las recetas preparadas contienen un ciclo: ${cycle.join(' -> ')}.`,
            { productSkus: cycle }
        ));
    }

    if (blockedDecisions.length > 0) {
        issues.push(issue(
            'WARNING',
            'PRODUCTION_BUSINESS_DECISIONS_PENDING',
            '$map',
            `Quedan ${blockedDecisions.length} decisiones bloqueantes; no se aplicará ningún subconjunto.`,
            {
                blockedOutputs: summary.blockedOutputs,
                blockedYields: summary.blockedYields,
                blockedComponents: summary.blockedComponents
            }
        ));
    }

    const contractValid = !issues.some((entry) => entry.severity === 'ERROR');
    const readyToApply = contractValid
        && blockedDecisions.length === 0
        && readyRecipes.length === sourceRecipes.length
        && summary.sourceRecipes === resolutionMap.recipes.length
        && summary.sourceComponents === summary.resolvedComponents;

    return {
        contractValid,
        readyToApply,
        applied: false,
        fingerprint,
        source: document.source,
        summary,
        issues,
        blockedDecisions,
        readyRecipes,
        databasePlan: null
    };
}

function parsePositiveId(raw: string, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} debe ser un entero positivo.`);
    return value;
}

function readFlagValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
    const token = args[index];
    const equals = token.indexOf('=');
    if (equals >= 0) {
        const value = token.slice(equals + 1).trim();
        if (!value) throw new Error(`${flag} requiere un valor.`);
        return { value, nextIndex: index };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return { value, nextIndex: index + 1 };
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        normalizedFile: DEFAULT_NORMALIZED_FILE,
        mapFile: DEFAULT_MAP_FILE,
        reportFile: null,
        companyId: null,
        userId: null,
        apply: false,
        help: false
    };
    let explicitMode: 'DRY_RUN' | 'APPLY' | null = null;

    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        const flag = token.split('=')[0];
        if (flag === '--help' || flag === '-h') {
            options.help = true;
        } else if (flag === '--dry-run') {
            if (explicitMode === 'APPLY') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'DRY_RUN';
            options.apply = false;
        } else if (flag === '--apply') {
            if (explicitMode === 'DRY_RUN') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'APPLY';
            options.apply = true;
        } else if (flag === '--normalized') {
            const read = readFlagValue(args, index, flag);
            options.normalizedFile = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--map') {
            const read = readFlagValue(args, index, flag);
            options.mapFile = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--report') {
            const read = readFlagValue(args, index, flag);
            options.reportFile = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--company-id') {
            const read = readFlagValue(args, index, flag);
            options.companyId = parsePositiveId(read.value, flag);
            index = read.nextIndex;
        } else if (flag === '--user-id') {
            const read = readFlagValue(args, index, flag);
            options.userId = parsePositiveId(read.value, flag);
            index = read.nextIndex;
        } else {
            throw new Error(`Opción desconocida: ${token}`);
        }
    }
    return options;
}

async function emitReport(report: ProductionPreparationReport, reportFile: string | null): Promise<void> {
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(rendered);
    if (reportFile) await writeFile(reportFile, rendered, 'utf8');
}

async function validateTenantAndActor(
    tx: Prisma.TransactionClient,
    companyId: number,
    userId: number
): Promise<void> {
    const [company, user] = await Promise.all([
        tx.company.findFirst({ where: { id: companyId, active: true }, select: { id: true } }),
        tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true } })
    ]);
    if (!company) throw new Error(`No existe una empresa activa con id ${companyId}.`);
    if (!user) throw new Error(`El usuario ${userId} no está activo o no pertenece a la empresa ${companyId}.`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }
    if (options.apply && !options.companyId) throw new Error('--company-id es obligatorio con --apply.');
    if (options.apply && !options.userId) throw new Error('--user-id es obligatorio con --apply.');

    const [normalizedRaw, mapRaw] = await Promise.all([
        readFile(options.normalizedFile, 'utf8'),
        readFile(options.mapFile, 'utf8')
    ]);
    let normalizedInput: unknown;
    let mapInput: unknown;
    try {
        normalizedInput = JSON.parse(normalizedRaw);
        mapInput = JSON.parse(mapRaw);
    } catch (error) {
        throw new Error(`JSON inválido: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(mapInput)) throw new Error('El mapa de producción debe ser un objeto JSON.');

    const parsed = parseNormalizedMenuRecipes(normalizedInput, { allowReviewRequired: true });
    if (!parsed.document || parsed.issues.some((entry) => entry.severity === 'ERROR')) {
        const detail = parsed.issues.map((entry) => `${entry.code}: ${entry.message}`).join('; ');
        throw new Error(`Contrato normalizado inválido: ${detail}`);
    }

    const fingerprint = sha256(`${normalizedRaw}\n${mapRaw}`);
    const report = prepareProductionRecipes(
        parsed.document,
        mapInput as unknown as ProductionResolutionMap,
        fingerprint
    );
    const parserWarnings = parsed.issues.filter((entry) => entry.severity === 'WARNING');
    if (parserWarnings.length > 0) {
        const productionReviewBlocks = parserWarnings.filter(
            (entry) => entry.code === 'REVIEW_REQUIRED' && entry.context?.candidateDomain === 'PRODUCTION'
        ).length;
        report.issues.unshift(issue(
            'WARNING',
            'NORMALIZED_REVIEW_QUEUE_EXCLUDED',
            '$.reviewRequired',
            `La cola general conserva ${parserWarnings.length} bloques fuera de estas 8 recetas; ${productionReviewBlocks} son candidatos de producción todavía no promovidos al contrato importable.`,
            { total: parserWarnings.length, production: productionReviewBlocks }
        ));
    }

    if (!report.readyToApply) {
        await emitReport(report, options.reportFile);
        if (options.apply) process.exitCode = 2;
        return;
    }

    if (!options.companyId) {
        report.readyToApply = false;
        report.issues.push(issue(
            'WARNING',
            'DATABASE_PLAN_SKIPPED',
            '$options.companyId',
            'La preparación está completa, pero falta --company-id para comprobar catálogo, unidades, versiones y ciclos existentes.'
        ));
        await emitReport(report, options.reportFile);
        return;
    }

    if (!options.apply) {
        report.databasePlan = await ProductionRecipeImportService.plan(report.readyRecipes, options.companyId);
        report.readyToApply = report.readyToApply && report.databasePlan.valid;
        await emitReport(report, options.reportFile);
        if (!report.readyToApply) process.exitCode = 1;
        return;
    }

    await prisma.$transaction(async (tx) => {
        await validateTenantAndActor(tx, options.companyId!, options.userId!);
        const plan = await ProductionRecipeImportService.plan(report.readyRecipes, options.companyId!, tx);
        report.databasePlan = plan;
        if (!plan.valid || plan.recipes.length !== report.readyRecipes.length) {
            throw new Error('El plan de base de datos no es válido; no se aplicó ningún cambio.');
        }

        await ProductionRecipeImportService.applyPlan(tx, plan, {
            companyId: options.companyId!,
            userId: options.userId!,
            fingerprint: report.fingerprint,
            source: {
                ...report.source,
                productionMap: path.basename(options.mapFile)
            }
        });

        const verification = await ProductionRecipeImportService.plan(report.readyRecipes, options.companyId!, tx);
        if (!verification.valid
            || verification.recipes.length !== report.readyRecipes.length
            || verification.summary.productionVersionsCreated !== 0
            || verification.summary.productionRecipesDeactivated !== 0) {
            throw new Error('La postcondición idempotente falló; se revirtió toda la transacción.');
        }
    }, {
        isolationLevel: 'Serializable',
        maxWait: 10_000,
        timeout: 180_000
    });

    report.applied = true;
    await emitReport(report, options.reportFile);
}

if (require.main === module) {
    main()
        .catch((error) => {
            process.stderr.write(`Error preparando recetas de producción: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
