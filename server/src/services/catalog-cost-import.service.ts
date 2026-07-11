import { createHash } from 'crypto';
import type { Prisma, ProductType, StorageType } from '@prisma/client';

import prisma from '../utils/prisma';

type CatalogCostDb = Prisma.TransactionClient | typeof prisma;

export type CatalogCostDecision = 'APPLY' | 'BLOCK' | 'IGNORE';
export type CatalogCostTargetMode = 'EXISTING' | 'CREATE' | 'UNRESOLVED';
export type CatalogCostActionKind = 'CREATE' | 'UPDATE' | 'UNCHANGED';
export type CatalogCostIssueSeverity = 'ERROR' | 'WARNING';
export type CatalogCostRole = 'PURCHASED_INPUT' | 'PORTION_OR_INTERMEDIATE' | 'PACKAGING' | 'CLEANING_SUPPLY';

export interface CatalogCostIssue {
    severity: CatalogCostIssueSeverity;
    code: string;
    path: string;
    message: string;
    context?: Record<string, unknown>;
}

export interface CatalogCostMapPolicy {
    sourceSelection: 'COMPLETE_COST_SHEET_THEN_COMPLETE_PURCHASE_FALLBACK';
    evaluatedPriceTreatment: 'USE_AS_EVALUATED';
    surcharge15Treatment: 'ALREADY_INCLUDED_WHEN_FORMULA_CONTAINS_1_15';
    updateField: 'cost';
    preserveCurrentAverageCost: true;
    preserveLastPurchaseCost: true;
    createPurchases: false;
    createStock: false;
    createInventoryMovements: false;
    createCostHistory: false;
}

export interface CatalogCostSourceFact {
    sheet: 'Costo de insumos' | 'Compras';
    row: number;
    asOfDate: string;
    priority: 'PRIMARY' | 'FALLBACK';
    name: string;
    presentation: string | null;
    unit: string | null;
    contentQuantity: number | null;
    evaluatedPrice: number | null;
    priceFormula: string | null;
}

export interface CatalogCostTarget {
    mode: CatalogCostTargetMode;
    sku: string | null;
    catalogName: string | null;
    baseUnit: string | null;
    category: string | null;
    productType: ProductType | null;
    storageType: StorageType | null;
    matchEvidence: 'FACT' | 'DERIVED' | 'ASSUMPTION' | 'NONE';
    catalogRole: CatalogCostRole;
}

export interface CatalogCostResolution {
    decision: CatalogCostDecision;
    blockers: string[];
    rationale: string;
}

export interface CatalogCostCalculationEvidence {
    normalizedSourceName: string;
    normalizedSourceUnit: string | null;
    surcharge15Detected: boolean;
    sourceUnitCost: number | null;
    expectedBaseUnitCost: number | null;
}

export interface CatalogCostMapEntry {
    id: string;
    source: CatalogCostSourceFact;
    target: CatalogCostTarget;
    resolution: CatalogCostResolution;
    calculation: CatalogCostCalculationEvidence;
    notes: string[];
}

export interface CatalogCostProductionCoverage {
    sourceName: string;
    normalizedName: string;
    status: 'EXISTING' | 'WILL_CREATE' | 'BLOCKED';
    targetSku: string | null;
    reason: string;
}

export interface CatalogCostMap {
    schemaVersion: 1;
    source: {
        file: string;
        sha256: string;
        generatedAt: string;
        catalogSnapshotAt: string;
    };
    policy: CatalogCostMapPolicy;
    entries: CatalogCostMapEntry[];
    productionCoverage: CatalogCostProductionCoverage[];
}

export interface PlannedCatalogCostAction {
    entryId: string;
    action: CatalogCostActionKind;
    source: CatalogCostSourceFact;
    targetMode: Exclude<CatalogCostTargetMode, 'UNRESOLVED'>;
    productId: number | null;
    sku: string;
    catalogName: string;
    baseUnitId: number;
    baseUnit: string;
    categoryId: number | null;
    productType: ProductType;
    storageType: StorageType | null;
    oldReferenceCost: number | null;
    newReferenceCost: number;
    currentAverageCost: number;
    lastPurchaseCost: number;
    effectiveCostBefore: number;
    effectiveCostAfter: number;
    totalStock: number;
    ensureBaseProductUnit: boolean;
    catalogRole: CatalogCostRole;
}

export interface CatalogCostImportReport {
    valid: boolean;
    complete: boolean;
    applied: boolean;
    dryRun: boolean;
    allowPartial: boolean;
    companyId: number;
    userId: number | null;
    fingerprint: string;
    source: CatalogCostMap['source'] | null;
    policy: CatalogCostMapPolicy | null;
    summary: {
        entries: number;
        applyRequested: number;
        blocked: number;
        ignored: number;
        creates: number;
        updates: number;
        unchanged: number;
        productionExisting: number;
        productionWillCreate: number;
        productionBlocked: number;
        applyPurchasedInputs: number;
        applyPortionsOrIntermediates: number;
        applyPackaging: number;
        applyCleaningSupplies: number;
        exactNamePreservedForUnitConflict: number;
    };
    issues: CatalogCostIssue[];
    blockedEntries: Array<{
        entryId: string;
        sourceName: string;
        source: string;
        blockers: string[];
        rationale: string;
    }>;
    productionCoverage: CatalogCostProductionCoverage[];
    catalogConflicts: Array<{
        entryId: string;
        sourceName: string;
        source: string;
        codes: string[];
        detail: string;
    }>;
    actions: PlannedCatalogCostAction[];
}

export interface CatalogCostImportOptions {
    companyId: number;
    userId?: number | null;
    dryRun?: boolean;
    allowPartial?: boolean;
    client?: typeof prisma;
}

type ParsedCatalogCostMap = {
    map: CatalogCostMap | null;
    issues: CatalogCostIssue[];
    fingerprint: string;
};

type ProductRow = {
    id: number;
    sku: string | null;
    name: string;
    unit: string;
    baseUnitId: number | null;
    categoryId: number | null;
    type: ProductType;
    storageType: StorageType | null;
    active: boolean;
    cost: Prisma.Decimal;
    currentAverageCost: Prisma.Decimal;
    lastPurchaseCost: Prisma.Decimal;
    stocks: Array<{ quantity: Prisma.Decimal }>;
    allowedUnits: Array<{
        unitId: number;
        conversionFactor: Prisma.Decimal;
        isDefault: boolean;
        active: boolean;
    }>;
};

type UnitRow = {
    id: number;
    abbreviation: string;
    measurementType: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
    systemFactor: Prisma.Decimal;
    active: boolean;
};

type CategoryRow = { id: number; name: string; active: boolean };

const PRODUCT_TYPES = new Set<ProductType>([
    'INGREDIENT',
    'PRODUCT_FOR_SALE',
    'BOTH',
    'INTERMEDIATE',
    'PACKAGING'
]);
const STORAGE_TYPES = new Set<StorageType>(['PERISHABLE', 'FROZEN', 'NON_PERISHABLE']);
const EXPECTED_POLICY: CatalogCostMapPolicy = {
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

const UNIT_ALIASES: Record<string, string> = {
    gr: 'g',
    gramo: 'g',
    gramos: 'g',
    kg: 'kg',
    kilogramo: 'kg',
    kilogramos: 'kg',
    lb: 'lb',
    libra: 'lb',
    libras: 'lb',
    oz: 'oz',
    onz: 'oz',
    onza: 'oz',
    onzas: 'oz',
    l: 'l',
    lt: 'l',
    litro: 'l',
    litros: 'l',
    ml: 'ml',
    gal: 'gal',
    galon: 'gal',
    galones: 'gal',
    qq: 'qq',
    qn: 'qq',
    quintal: 'qq',
    und: 'unidad',
    unid: 'unidad',
    uniidad: 'unidad',
    nidad: 'unidad',
    unit: 'unidad',
    unidad: 'unidad',
    unidades: 'unidad',
    slice: 'unidad',
    lasca: 'unidad',
    rollo: 'unidad',
    sobre: 'unidad',
    bandeja: 'unidad',
    moño: 'unidad',
    mono: 'unidad',
    pack: 'paquete',
    paq: 'paquete',
    paquete: 'paquete',
    caj: 'caja',
    caja: 'caja',
    saco: 'saco'
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned || null;
}

export function normalizeCatalogCostText(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('es')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function normalizeCatalogCostUnit(value: string): string {
    const normalized = normalizeCatalogCostText(value).replace(/\s+/g, '');
    return UNIT_ALIASES[normalized] ?? normalized;
}

function normalizeCode(value: string): string {
    return value.trim().toUpperCase();
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? JSON.stringify(String(value));
}

function fingerprint(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function issue(
    severity: CatalogCostIssueSeverity,
    code: string,
    path: string,
    message: string,
    context?: Record<string, unknown>
): CatalogCostIssue {
    return { severity, code, path, message, ...(context ? { context } : {}) };
}

function sameMoney(left: number, right: number): boolean {
    return Math.abs(left - right) <= 0.005;
}

function roundCost(value: number): number {
    return Number(value.toFixed(2));
}

function parseNullableString(value: unknown, path: string, issues: CatalogCostIssue[]): string | null {
    if (value === null || value === undefined) return null;
    const parsed = cleanString(value);
    if (!parsed) issues.push(issue('ERROR', 'STRING_INVALID', path, 'Debe ser texto no vacío o null.'));
    return parsed;
}

export function parseCatalogCostMap(input: unknown): ParsedCatalogCostMap {
    const issues: CatalogCostIssue[] = [];
    const inputFingerprint = fingerprint(input);
    if (!isRecord(input)) {
        return {
            map: null,
            issues: [issue('ERROR', 'DOCUMENT_INVALID', '$', 'El mapa de costos debe ser un objeto.')],
            fingerprint: inputFingerprint
        };
    }
    if (input.schemaVersion !== 1) {
        issues.push(issue('ERROR', 'SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', 'schemaVersion debe ser 1.'));
    }

    const sourceRaw = input.source;
    const sourceFile = isRecord(sourceRaw) ? cleanString(sourceRaw.file) : null;
    const sourceSha256 = isRecord(sourceRaw) ? cleanString(sourceRaw.sha256) : null;
    const generatedAt = isRecord(sourceRaw) ? cleanString(sourceRaw.generatedAt) : null;
    const catalogSnapshotAt = isRecord(sourceRaw) ? cleanString(sourceRaw.catalogSnapshotAt) : null;
    if (!sourceFile) issues.push(issue('ERROR', 'SOURCE_FILE_REQUIRED', '$.source.file', 'source.file es requerido.'));
    if (!sourceSha256 || !/^[a-f0-9]{64}$/i.test(sourceSha256)) {
        issues.push(issue('ERROR', 'SOURCE_SHA256_INVALID', '$.source.sha256', 'source.sha256 debe ser SHA-256 hexadecimal.'));
    }
    if (!generatedAt) issues.push(issue('ERROR', 'GENERATED_AT_REQUIRED', '$.source.generatedAt', 'generatedAt es requerido.'));
    if (!catalogSnapshotAt) issues.push(issue('ERROR', 'CATALOG_SNAPSHOT_AT_REQUIRED', '$.source.catalogSnapshotAt', 'catalogSnapshotAt es requerido.'));

    const policyRaw = input.policy;
    let policy: CatalogCostMapPolicy | null = null;
    if (!isRecord(policyRaw)) {
        issues.push(issue('ERROR', 'POLICY_REQUIRED', '$.policy', 'La política de seguridad es requerida.'));
    } else {
        const mismatches = Object.entries(EXPECTED_POLICY)
            .filter(([key, expected]) => policyRaw[key] !== expected)
            .map(([key, expected]) => ({ key, expected, actual: policyRaw[key] }));
        if (mismatches.length > 0) {
            issues.push(issue(
                'ERROR',
                'UNSAFE_POLICY',
                '$.policy',
                'La política debe preservar costos operativos y no crear artefactos de inventario.',
                { mismatches }
            ));
        } else policy = { ...EXPECTED_POLICY };
    }

    if (!Array.isArray(input.entries) || input.entries.length === 0) {
        issues.push(issue('ERROR', 'ENTRIES_INVALID', '$.entries', 'entries debe ser un arreglo no vacío.'));
    }

    const entries: CatalogCostMapEntry[] = [];
    const ids = new Set<string>();
    const applySkus = new Set<string>();
    const rawEntries = Array.isArray(input.entries) ? input.entries : [];
    rawEntries.forEach((rawEntry, index) => {
        const path = `$.entries[${index}]`;
        if (!isRecord(rawEntry)) {
            issues.push(issue('ERROR', 'ENTRY_INVALID', path, 'La entrada debe ser un objeto.'));
            return;
        }
        const id = cleanString(rawEntry.id);
        if (!id) issues.push(issue('ERROR', 'ENTRY_ID_REQUIRED', `${path}.id`, 'id es requerido.'));
        else if (ids.has(id)) issues.push(issue('ERROR', 'ENTRY_ID_DUPLICATE', `${path}.id`, `id duplicado: ${id}.`));
        else ids.add(id);

        const sourceRawEntry = rawEntry.source;
        if (!isRecord(sourceRawEntry)) {
            issues.push(issue('ERROR', 'SOURCE_FACT_INVALID', `${path}.source`, 'source debe ser un objeto.'));
            return;
        }
        const sheet = sourceRawEntry.sheet === 'Costo de insumos' || sourceRawEntry.sheet === 'Compras'
            ? sourceRawEntry.sheet
            : null;
        const row = finiteNumber(sourceRawEntry.row);
        const asOfDate = cleanString(sourceRawEntry.asOfDate);
        const priority = sourceRawEntry.priority === 'PRIMARY' || sourceRawEntry.priority === 'FALLBACK'
            ? sourceRawEntry.priority
            : null;
        const name = cleanString(sourceRawEntry.name);
        const presentation = parseNullableString(sourceRawEntry.presentation, `${path}.source.presentation`, issues);
        const unit = parseNullableString(sourceRawEntry.unit, `${path}.source.unit`, issues);
        const contentQuantity = sourceRawEntry.contentQuantity === null
            ? null
            : finiteNumber(sourceRawEntry.contentQuantity);
        const evaluatedPrice = sourceRawEntry.evaluatedPrice === null
            ? null
            : finiteNumber(sourceRawEntry.evaluatedPrice);
        const priceFormula = parseNullableString(sourceRawEntry.priceFormula, `${path}.source.priceFormula`, issues);
        if (!sheet) issues.push(issue('ERROR', 'SOURCE_SHEET_INVALID', `${path}.source.sheet`, 'Hoja fuente no válida.'));
        if (!row || !Number.isInteger(row) || row <= 0) issues.push(issue('ERROR', 'SOURCE_ROW_INVALID', `${path}.source.row`, 'row debe ser entero positivo.'));
        if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) issues.push(issue('ERROR', 'SOURCE_DATE_INVALID', `${path}.source.asOfDate`, 'Use YYYY-MM-DD.'));
        if (!priority) issues.push(issue('ERROR', 'SOURCE_PRIORITY_INVALID', `${path}.source.priority`, 'priority debe ser PRIMARY o FALLBACK.'));
        if (!name) issues.push(issue('ERROR', 'SOURCE_NAME_REQUIRED', `${path}.source.name`, 'name es requerido.'));
        if (sourceRawEntry.contentQuantity !== null && (contentQuantity === null || contentQuantity <= 0)) {
            issues.push(issue('ERROR', 'SOURCE_QUANTITY_INVALID', `${path}.source.contentQuantity`, 'Debe ser mayor que cero o null.'));
        }
        if (sourceRawEntry.evaluatedPrice !== null && (evaluatedPrice === null || evaluatedPrice <= 0)) {
            issues.push(issue('ERROR', 'SOURCE_PRICE_INVALID', `${path}.source.evaluatedPrice`, 'Debe ser mayor que cero o null.'));
        }

        const targetRaw = rawEntry.target;
        if (!isRecord(targetRaw)) {
            issues.push(issue('ERROR', 'TARGET_INVALID', `${path}.target`, 'target debe ser un objeto.'));
            return;
        }
        const mode = targetRaw.mode === 'EXISTING' || targetRaw.mode === 'CREATE' || targetRaw.mode === 'UNRESOLVED'
            ? targetRaw.mode
            : null;
        const sku = parseNullableString(targetRaw.sku, `${path}.target.sku`, issues);
        const catalogName = parseNullableString(targetRaw.catalogName, `${path}.target.catalogName`, issues);
        const baseUnit = parseNullableString(targetRaw.baseUnit, `${path}.target.baseUnit`, issues);
        const category = parseNullableString(targetRaw.category, `${path}.target.category`, issues);
        const productType = typeof targetRaw.productType === 'string' && PRODUCT_TYPES.has(targetRaw.productType as ProductType)
            ? targetRaw.productType as ProductType
            : targetRaw.productType === null
                ? null
                : undefined;
        const storageType = typeof targetRaw.storageType === 'string' && STORAGE_TYPES.has(targetRaw.storageType as StorageType)
            ? targetRaw.storageType as StorageType
            : targetRaw.storageType === null
                ? null
                : undefined;
        const matchEvidence = targetRaw.matchEvidence === 'FACT'
            || targetRaw.matchEvidence === 'DERIVED'
            || targetRaw.matchEvidence === 'ASSUMPTION'
            || targetRaw.matchEvidence === 'NONE'
            ? targetRaw.matchEvidence
            : null;
        const catalogRole = targetRaw.catalogRole === 'PURCHASED_INPUT'
            || targetRaw.catalogRole === 'PORTION_OR_INTERMEDIATE'
            || targetRaw.catalogRole === 'PACKAGING'
            || targetRaw.catalogRole === 'CLEANING_SUPPLY'
            ? targetRaw.catalogRole
            : null;
        if (!mode) issues.push(issue('ERROR', 'TARGET_MODE_INVALID', `${path}.target.mode`, 'mode no válido.'));
        if (productType === undefined) issues.push(issue('ERROR', 'PRODUCT_TYPE_INVALID', `${path}.target.productType`, 'productType no válido.'));
        if (storageType === undefined) issues.push(issue('ERROR', 'STORAGE_TYPE_INVALID', `${path}.target.storageType`, 'storageType no válido.'));
        if (!matchEvidence) issues.push(issue('ERROR', 'MATCH_EVIDENCE_INVALID', `${path}.target.matchEvidence`, 'matchEvidence no válido.'));
        if (!catalogRole) issues.push(issue('ERROR', 'CATALOG_ROLE_INVALID', `${path}.target.catalogRole`, 'catalogRole no válido.'));

        const resolutionRaw = rawEntry.resolution;
        if (!isRecord(resolutionRaw)) {
            issues.push(issue('ERROR', 'RESOLUTION_INVALID', `${path}.resolution`, 'resolution debe ser un objeto.'));
            return;
        }
        const decision = resolutionRaw.decision === 'APPLY'
            || resolutionRaw.decision === 'BLOCK'
            || resolutionRaw.decision === 'IGNORE'
            ? resolutionRaw.decision
            : null;
        const blockers = Array.isArray(resolutionRaw.blockers)
            ? resolutionRaw.blockers.map(cleanString).filter((value): value is string => Boolean(value))
            : [];
        const rationale = cleanString(resolutionRaw.rationale);
        if (!decision) issues.push(issue('ERROR', 'DECISION_INVALID', `${path}.resolution.decision`, 'decision no válida.'));
        if (!rationale) issues.push(issue('ERROR', 'RATIONALE_REQUIRED', `${path}.resolution.rationale`, 'rationale es requerido.'));
        if (decision === 'BLOCK' && blockers.length === 0) {
            issues.push(issue('ERROR', 'BLOCKERS_REQUIRED', `${path}.resolution.blockers`, 'Una fila bloqueada debe explicar el bloqueo.'));
        }

        const calculationRaw = rawEntry.calculation;
        if (!isRecord(calculationRaw)) {
            issues.push(issue('ERROR', 'CALCULATION_INVALID', `${path}.calculation`, 'calculation debe ser un objeto.'));
            return;
        }
        const normalizedSourceName = cleanString(calculationRaw.normalizedSourceName);
        const normalizedSourceUnit = parseNullableString(calculationRaw.normalizedSourceUnit, `${path}.calculation.normalizedSourceUnit`, issues);
        const surcharge15Detected = typeof calculationRaw.surcharge15Detected === 'boolean'
            ? calculationRaw.surcharge15Detected
            : null;
        const sourceUnitCost = calculationRaw.sourceUnitCost === null ? null : finiteNumber(calculationRaw.sourceUnitCost);
        const expectedBaseUnitCost = calculationRaw.expectedBaseUnitCost === null ? null : finiteNumber(calculationRaw.expectedBaseUnitCost);
        if (!normalizedSourceName) issues.push(issue('ERROR', 'NORMALIZED_NAME_REQUIRED', `${path}.calculation.normalizedSourceName`, 'normalizedSourceName es requerido.'));
        if (surcharge15Detected === null) issues.push(issue('ERROR', 'SURCHARGE_FLAG_INVALID', `${path}.calculation.surcharge15Detected`, 'Debe ser booleano.'));
        if (calculationRaw.sourceUnitCost !== null && (sourceUnitCost === null || sourceUnitCost <= 0)) {
            issues.push(issue('ERROR', 'SOURCE_UNIT_COST_INVALID', `${path}.calculation.sourceUnitCost`, 'Debe ser mayor que cero o null.'));
        }
        if (calculationRaw.expectedBaseUnitCost !== null && (expectedBaseUnitCost === null || expectedBaseUnitCost <= 0)) {
            issues.push(issue('ERROR', 'EXPECTED_BASE_COST_INVALID', `${path}.calculation.expectedBaseUnitCost`, 'Debe ser mayor que cero o null.'));
        }

        const notes = Array.isArray(rawEntry.notes)
            ? rawEntry.notes.map(cleanString).filter((value): value is string => Boolean(value))
            : [];

        if (decision === 'APPLY') {
            if (mode !== 'EXISTING' && mode !== 'CREATE') {
                issues.push(issue('ERROR', 'APPLY_TARGET_UNRESOLVED', `${path}.target.mode`, 'APPLY requiere EXISTING o CREATE.'));
            }
            if (!sku || !catalogName || !baseUnit || !productType || !unit || !contentQuantity || !evaluatedPrice) {
                issues.push(issue('ERROR', 'APPLY_FIELDS_MISSING', path, 'APPLY requiere SKU, nombre, unidad base, tipo, unidad/contenido y precio fuente.'));
            }
            if (mode === 'CREATE' && !category) {
                issues.push(issue('ERROR', 'CREATE_CATEGORY_REQUIRED', `${path}.target.category`, 'CREATE requiere category.'));
            }
            if (matchEvidence === 'ASSUMPTION') {
                issues.push(issue('ERROR', 'UNAPPROVED_ASSUMPTION', `${path}.target.matchEvidence`, 'Una suposición no puede aplicarse automáticamente.'));
            }
            if (sku) {
                const normalizedSku = normalizeCode(sku);
                if (applySkus.has(normalizedSku)) {
                    issues.push(issue('ERROR', 'APPLY_SKU_DUPLICATE', `${path}.target.sku`, `Más de una fila APPLY apunta a ${sku}.`));
                }
                applySkus.add(normalizedSku);
            }
        }

        if (!id || !sheet || !row || !asOfDate || !priority || !name || !mode || !matchEvidence || !catalogRole
            || !decision || !rationale || !normalizedSourceName || surcharge15Detected === null
            || productType === undefined || storageType === undefined) return;

        entries.push({
            id,
            source: {
                sheet,
                row,
                asOfDate,
                priority,
                name,
                presentation,
                unit,
                contentQuantity,
                evaluatedPrice,
                priceFormula
            },
            target: {
                mode,
                sku,
                catalogName,
                baseUnit,
                category,
                productType,
                storageType,
                matchEvidence,
                catalogRole
            },
            resolution: { decision, blockers, rationale },
            calculation: {
                normalizedSourceName,
                normalizedSourceUnit,
                surcharge15Detected,
                sourceUnitCost,
                expectedBaseUnitCost
            },
            notes
        });
    });

    const coverage: CatalogCostProductionCoverage[] = [];
    const rawCoverage = input.productionCoverage;
    if (rawCoverage !== undefined && !Array.isArray(rawCoverage)) {
        issues.push(issue('ERROR', 'PRODUCTION_COVERAGE_INVALID', '$.productionCoverage', 'productionCoverage debe ser un arreglo.'));
    } else if (Array.isArray(rawCoverage)) {
        rawCoverage.forEach((raw, index) => {
            const path = `$.productionCoverage[${index}]`;
            if (!isRecord(raw)) {
                issues.push(issue('ERROR', 'PRODUCTION_COVERAGE_ENTRY_INVALID', path, 'La cobertura debe ser un objeto.'));
                return;
            }
            const sourceName = cleanString(raw.sourceName);
            const normalizedName = cleanString(raw.normalizedName);
            const status = raw.status === 'EXISTING' || raw.status === 'WILL_CREATE' || raw.status === 'BLOCKED'
                ? raw.status
                : null;
            const targetSku = parseNullableString(raw.targetSku, `${path}.targetSku`, issues);
            const reason = cleanString(raw.reason);
            if (!sourceName || !normalizedName || !status || !reason) {
                issues.push(issue('ERROR', 'PRODUCTION_COVERAGE_FIELDS_MISSING', path, 'Cobertura incompleta.'));
                return;
            }
            coverage.push({ sourceName, normalizedName, status, targetSku, reason });
        });
    }

    const map = sourceFile && sourceSha256 && generatedAt && catalogSnapshotAt && policy
        ? {
            schemaVersion: 1 as const,
            source: { file: sourceFile, sha256: sourceSha256, generatedAt, catalogSnapshotAt },
            policy,
            entries,
            productionCoverage: coverage
        }
        : null;
    return { map, issues, fingerprint: inputFingerprint };
}

export class CatalogCostImportError extends Error {
    constructor(public readonly report: CatalogCostImportReport) {
        super('La importación de catálogo/costos no superó la validación.');
        this.name = 'CatalogCostImportError';
    }
}

function summaryFromMap(map: CatalogCostMap | null): CatalogCostImportReport['summary'] {
    const entries = map?.entries ?? [];
    const coverage = map?.productionCoverage ?? [];
    const apply = entries.filter((entry) => entry.resolution.decision === 'APPLY');
    return {
        entries: entries.length,
        applyRequested: entries.filter((entry) => entry.resolution.decision === 'APPLY').length,
        blocked: entries.filter((entry) => entry.resolution.decision === 'BLOCK').length,
        ignored: entries.filter((entry) => entry.resolution.decision === 'IGNORE').length,
        creates: 0,
        updates: 0,
        unchanged: 0,
        productionExisting: coverage.filter((entry) => entry.status === 'EXISTING').length,
        productionWillCreate: coverage.filter((entry) => entry.status === 'WILL_CREATE').length,
        productionBlocked: coverage.filter((entry) => entry.status === 'BLOCKED').length,
        applyPurchasedInputs: apply.filter((entry) => entry.target.catalogRole === 'PURCHASED_INPUT').length,
        applyPortionsOrIntermediates: apply.filter((entry) => entry.target.catalogRole === 'PORTION_OR_INTERMEDIATE').length,
        applyPackaging: apply.filter((entry) => entry.target.catalogRole === 'PACKAGING').length,
        applyCleaningSupplies: apply.filter((entry) => entry.target.catalogRole === 'CLEANING_SUPPLY').length,
        exactNamePreservedForUnitConflict: entries.filter((entry) => entry.notes.some((note) => note.startsWith('Catálogo incompatible preservado:'))).length
    };
}

function conflictsFromMap(map: CatalogCostMap | null): CatalogCostImportReport['catalogConflicts'] {
    if (!map) return [];
    return map.entries.flatMap((entry) => {
        const codes = entry.resolution.blockers.filter((code) => /CATALOG|SKU|DUPLICATE|AMBIGUOUS|CONFLICT/.test(code));
        const preserved = entry.notes.find((note) => note.startsWith('Catálogo incompatible preservado:'));
        if (codes.length === 0 && !preserved) return [];
        return [{
            entryId: entry.id,
            sourceName: entry.source.name,
            source: `${entry.source.sheet}!${entry.source.row}`,
            codes: preserved ? [...codes, 'EXACT_NAME_UNIT_CONFLICT_PRESERVED'] : codes,
            detail: preserved ?? entry.resolution.rationale
        }];
    });
}

function emptyReport(parsed: ParsedCatalogCostMap, options: CatalogCostImportOptions): CatalogCostImportReport {
    const map = parsed.map;
    return {
        valid: false,
        complete: false,
        applied: false,
        dryRun: options.dryRun !== false,
        allowPartial: options.allowPartial === true,
        companyId: options.companyId,
        userId: options.userId ?? null,
        fingerprint: parsed.fingerprint,
        source: map?.source ?? null,
        policy: map?.policy ?? null,
        summary: summaryFromMap(map),
        issues: [...parsed.issues],
        blockedEntries: (map?.entries ?? [])
            .filter((entry) => entry.resolution.decision === 'BLOCK')
            .map((entry) => ({
                entryId: entry.id,
                sourceName: entry.source.name,
                source: `${entry.source.sheet}!${entry.source.row}`,
                blockers: entry.resolution.blockers,
                rationale: entry.resolution.rationale
            })),
        productionCoverage: map?.productionCoverage ?? [],
        catalogConflicts: conflictsFromMap(map),
        actions: []
    };
}

export class CatalogCostImportService {
    static async listValidAuditUsers(companyId: number, db: CatalogCostDb = prisma): Promise<Array<{ id: number; name: string }>> {
        return db.user.findMany({
            where: { companyId, status: 'ACTIVE' },
            select: { id: true, name: true },
            orderBy: { id: 'asc' }
        });
    }

    static async plan(
        map: CatalogCostMap,
        options: CatalogCostImportOptions,
        db: CatalogCostDb = prisma,
        mapFingerprint = fingerprint(map)
    ): Promise<CatalogCostImportReport> {
        const report: CatalogCostImportReport = {
            valid: false,
            complete: false,
            applied: false,
            dryRun: options.dryRun !== false,
            allowPartial: options.allowPartial === true,
            companyId: options.companyId,
            userId: options.userId ?? null,
            fingerprint: mapFingerprint,
            source: map.source,
            policy: map.policy,
            summary: summaryFromMap(map),
            issues: [],
            blockedEntries: map.entries
                .filter((entry) => entry.resolution.decision === 'BLOCK')
                .map((entry) => ({
                    entryId: entry.id,
                    sourceName: entry.source.name,
                    source: `${entry.source.sheet}!${entry.source.row}`,
                    blockers: entry.resolution.blockers,
                    rationale: entry.resolution.rationale
                })),
            productionCoverage: map.productionCoverage,
            catalogConflicts: conflictsFromMap(map),
            actions: []
        };
        if (!Number.isInteger(options.companyId) || options.companyId <= 0) {
            report.issues.push(issue('ERROR', 'COMPANY_ID_INVALID', '$options.companyId', 'companyId debe ser entero positivo.'));
            return report;
        }
        const company = await db.company.findFirst({
            where: { id: options.companyId, active: true },
            select: { id: true, name: true }
        });
        if (!company) {
            report.issues.push(issue('ERROR', 'COMPANY_NOT_FOUND', '$options.companyId', `No existe empresa activa ${options.companyId}.`));
            return report;
        }
        if (options.dryRun === false) {
            const users = await this.listValidAuditUsers(options.companyId, db);
            if (!options.userId || !users.some((user) => user.id === options.userId)) {
                report.issues.push(issue(
                    'ERROR',
                    options.userId ? 'AUDIT_USER_INVALID' : 'AUDIT_USER_REQUIRED',
                    '$options.userId',
                    'Se requiere un usuario activo de la empresa.',
                    { validUsers: users }
                ));
                return report;
            }
        }
        if (report.summary.blocked > 0 && !options.allowPartial) {
            report.issues.push(issue(
                'ERROR',
                'UNRESOLVED_ENTRIES',
                '$.entries',
                `Hay ${report.summary.blocked} filas bloqueadas. Corríjalas o use --allow-partial de forma explícita.`
            ));
        }

        const applyEntries = map.entries.filter((entry) => entry.resolution.decision === 'APPLY');
        const [products, units, categories] = await Promise.all([
            db.product.findMany({
                where: {
                    companyId: options.companyId,
                    sku: { in: applyEntries.map((entry) => entry.target.sku!).filter(Boolean) }
                },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    unit: true,
                    baseUnitId: true,
                    categoryId: true,
                    type: true,
                    storageType: true,
                    active: true,
                    cost: true,
                    currentAverageCost: true,
                    lastPurchaseCost: true,
                    stocks: { select: { quantity: true } },
                    allowedUnits: {
                        select: { unitId: true, conversionFactor: true, isDefault: true, active: true }
                    }
                }
            }) as unknown as Promise<ProductRow[]>,
            db.unitOfMeasure.findMany({
                where: { companyId: options.companyId, active: true },
                select: { id: true, abbreviation: true, measurementType: true, systemFactor: true, active: true }
            }) as unknown as Promise<UnitRow[]>,
            db.category.findMany({
                where: {
                    companyId: options.companyId,
                    name: { in: applyEntries.map((entry) => entry.target.category).filter((name): name is string => Boolean(name)) }
                },
                select: { id: true, name: true, active: true }
            }) as unknown as Promise<CategoryRow[]>
        ]);

        const productBySku = new Map(products.map((product) => [normalizeCode(product.sku ?? ''), product]));
        const unitByKey = new Map(units.map((unit) => [normalizeCatalogCostUnit(unit.abbreviation), unit]));
        const categoryByName = new Map(categories.filter((category) => category.active).map((category) => [normalizeCatalogCostText(category.name), category]));

        for (let index = 0; index < applyEntries.length; index++) {
            const entry = applyEntries[index];
            const mapIndex = map.entries.indexOf(entry);
            const path = `$.entries[${mapIndex}]`;
            const sourceUnitKey = normalizeCatalogCostUnit(entry.source.unit!);
            const targetUnitKey = normalizeCatalogCostUnit(entry.target.baseUnit!);
            const sourceUnit = unitByKey.get(sourceUnitKey);
            const targetUnit = unitByKey.get(targetUnitKey);
            if (!sourceUnit) {
                report.issues.push(issue('ERROR', 'SOURCE_UNIT_NOT_FOUND', `${path}.source.unit`, `No existe unidad activa ${entry.source.unit}.`));
                continue;
            }
            if (!targetUnit) {
                report.issues.push(issue('ERROR', 'BASE_UNIT_NOT_FOUND', `${path}.target.baseUnit`, `No existe unidad activa ${entry.target.baseUnit}.`));
                continue;
            }
            if (sourceUnit.measurementType !== targetUnit.measurementType) {
                report.issues.push(issue(
                    'ERROR',
                    'UNIT_MEASUREMENT_MISMATCH',
                    path,
                    `${sourceUnit.abbreviation} (${sourceUnit.measurementType}) no convierte a ${targetUnit.abbreviation} (${targetUnit.measurementType}).`
                ));
                continue;
            }

            const quantityInBase = entry.source.contentQuantity!
                * Number(sourceUnit.systemFactor)
                / Number(targetUnit.systemFactor);
            const exactCost = entry.source.evaluatedPrice! / quantityInBase;
            const newReferenceCost = roundCost(exactCost);
            if (!Number.isFinite(newReferenceCost) || newReferenceCost <= 0) {
                report.issues.push(issue(
                    'ERROR',
                    'COST_PRECISION_LOSS',
                    `${path}.source.evaluatedPrice`,
                    `El costo ${exactCost} no cabe con precisión útil en Product.cost DECIMAL(10,2).`,
                    { exactCost, roundedCost: newReferenceCost }
                ));
                continue;
            }
            if (entry.calculation.expectedBaseUnitCost !== null
                && !sameMoney(entry.calculation.expectedBaseUnitCost, newReferenceCost)) {
                report.issues.push(issue(
                    'ERROR',
                    'EXPECTED_COST_MISMATCH',
                    `${path}.calculation.expectedBaseUnitCost`,
                    'El costo esperado no coincide con precio/contenido/conversión.',
                    { expected: entry.calculation.expectedBaseUnitCost, calculated: newReferenceCost }
                ));
                continue;
            }

            const sku = normalizeCode(entry.target.sku!);
            const product = productBySku.get(sku);
            if (entry.target.mode === 'EXISTING' && !product) {
                report.issues.push(issue('ERROR', 'EXISTING_PRODUCT_NOT_FOUND', `${path}.target.sku`, `No existe ${sku}.`));
                continue;
            }
            if (product && !product.active) {
                report.issues.push(issue('ERROR', 'PRODUCT_INACTIVE', `${path}.target.sku`, `${sku} está inactivo.`));
                continue;
            }
            if (product) {
                const actualUnitKey = normalizeCatalogCostUnit(product.unit);
                if (actualUnitKey !== targetUnitKey
                    || (product.baseUnitId !== null && product.baseUnitId !== targetUnit.id)) {
                    report.issues.push(issue(
                        'ERROR',
                        'PRODUCT_BASE_UNIT_MISMATCH',
                        `${path}.target.baseUnit`,
                        `${sku} usa ${product.unit}/baseUnitId=${product.baseUnitId}, no ${targetUnit.abbreviation}/id=${targetUnit.id}.`
                    ));
                    continue;
                }
                if (entry.target.mode === 'CREATE'
                    && (normalizeCatalogCostText(product.name) !== normalizeCatalogCostText(entry.target.catalogName!)
                        || product.type !== entry.target.productType)) {
                    report.issues.push(issue(
                        'ERROR',
                        'RESERVED_SKU_CONFLICT',
                        `${path}.target.sku`,
                        `${sku} ya existe con identidad incompatible.`,
                        { actualName: product.name, actualType: product.type }
                    ));
                    continue;
                }
            }

            let categoryId: number | null = product?.categoryId ?? null;
            if (!product && entry.target.mode === 'CREATE') {
                const category = categoryByName.get(normalizeCatalogCostText(entry.target.category!));
                if (!category) {
                    report.issues.push(issue('ERROR', 'CATEGORY_NOT_FOUND', `${path}.target.category`, `No existe categoría activa ${entry.target.category}.`));
                    continue;
                }
                categoryId = category.id;
            }

            const oldReferenceCost = product ? Number(product.cost) : null;
            const currentAverageCost = product ? Number(product.currentAverageCost) : 0;
            const lastPurchaseCost = product ? Number(product.lastPurchaseCost) : 0;
            const totalStock = product?.stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0) ?? 0;
            const effectiveCostBefore = currentAverageCost > 0 ? currentAverageCost : (oldReferenceCost ?? 0);
            const effectiveCostAfter = currentAverageCost > 0 ? currentAverageCost : newReferenceCost;
            const hasBaseUnit = product?.allowedUnits.some((allowed) => allowed.unitId === targetUnit.id
                && allowed.active
                && allowed.isDefault
                && Math.abs(Number(allowed.conversionFactor) - 1) <= 0.0000005) ?? false;
            const ensureBaseProductUnit = !product || !hasBaseUnit;

            let action: CatalogCostActionKind;
            if (!product) action = 'CREATE';
            else if (!sameMoney(Number(product.cost), newReferenceCost) || ensureBaseProductUnit) action = 'UPDATE';
            else action = 'UNCHANGED';

            report.actions.push({
                entryId: entry.id,
                action,
                source: entry.source,
                targetMode: entry.target.mode as Exclude<CatalogCostTargetMode, 'UNRESOLVED'>,
                productId: product?.id ?? null,
                sku,
                catalogName: entry.target.catalogName!,
                baseUnitId: targetUnit.id,
                baseUnit: targetUnit.abbreviation,
                categoryId,
                productType: entry.target.productType!,
                storageType: entry.target.storageType,
                oldReferenceCost,
                newReferenceCost,
                currentAverageCost,
                lastPurchaseCost,
                effectiveCostBefore,
                effectiveCostAfter,
                totalStock,
                ensureBaseProductUnit,
                catalogRole: entry.target.catalogRole
            });
            if (action === 'CREATE') report.summary.creates++;
            else if (action === 'UPDATE') report.summary.updates++;
            else report.summary.unchanged++;
        }

        report.complete = report.summary.blocked === 0 && report.summary.productionBlocked === 0;
        report.valid = !report.issues.some((entry) => entry.severity === 'ERROR')
            && report.actions.length === report.summary.applyRequested;
        return report;
    }

    private static async applyPlan(
        tx: Prisma.TransactionClient,
        report: CatalogCostImportReport,
        userId: number
    ): Promise<void> {
        for (const action of report.actions) {
            let productId = action.productId;
            if (action.action === 'CREATE') {
                const created = await tx.product.create({
                    data: {
                        companyId: report.companyId,
                        name: action.catalogName,
                        sku: action.sku,
                        categoryId: action.categoryId,
                        unit: action.baseUnit,
                        baseUnitId: action.baseUnitId,
                        minStock: 0,
                        cost: action.newReferenceCost,
                        currentAverageCost: 0,
                        lastPurchaseCost: 0,
                        type: action.productType,
                        storageType: action.storageType,
                        observation: `Creado desde ${report.source?.file ?? 'matriz de costos'}; costo de referencia sin compra ni stock.`,
                        active: true
                    }
                });
                productId = created.id;
            } else if (action.action === 'UPDATE' && productId) {
                await tx.product.update({
                    where: { id: productId },
                    data: { cost: action.newReferenceCost }
                });
            }
            if (!productId) throw new Error(`No se pudo determinar productId para ${action.sku}.`);
            if (action.ensureBaseProductUnit) {
                await tx.productUnit.upsert({
                    where: { productId_unitId: { productId, unitId: action.baseUnitId } },
                    update: { conversionFactor: 1, isDefault: true, active: true },
                    create: {
                        companyId: report.companyId,
                        productId,
                        unitId: action.baseUnitId,
                        conversionFactor: 1,
                        isDefault: true,
                        active: true
                    }
                });
            }
            if (action.action !== 'UNCHANGED') {
                await tx.auditLog.create({
                    data: {
                        companyId: report.companyId,
                        userId,
                        entityType: 'Product',
                        entityId: productId,
                        action: 'IMPORT',
                        details: {
                            source: action.source,
                            mapFingerprint: report.fingerprint,
                            catalogCostImport: true,
                            action: action.action,
                            sku: action.sku,
                            referenceCostBefore: action.oldReferenceCost,
                            referenceCostAfter: action.newReferenceCost,
                            currentAverageCostPreserved: action.currentAverageCost,
                            lastPurchaseCostPreserved: action.lastPurchaseCost,
                            effectiveCostBefore: action.effectiveCostBefore,
                            effectiveCostAfter: action.effectiveCostAfter,
                            totalStockPreserved: action.totalStock,
                            createsPurchase: false,
                            createsStock: false,
                            createsInventoryMovement: false,
                            createsCostHistory: false
                        } as unknown as Prisma.InputJsonValue
                    }
                });
            }
        }
    }

    static async importMap(input: unknown, options: CatalogCostImportOptions): Promise<CatalogCostImportReport> {
        const parsed = parseCatalogCostMap(input);
        const base = emptyReport(parsed, options);
        if (!parsed.map || parsed.issues.some((entry) => entry.severity === 'ERROR')) return base;
        const client = options.client ?? prisma;
        if (options.dryRun !== false) {
            const report = await this.plan(parsed.map, { ...options, dryRun: true }, client, parsed.fingerprint);
            report.issues.unshift(...parsed.issues);
            report.valid = !report.issues.some((entry) => entry.severity === 'ERROR')
                && report.actions.length === report.summary.applyRequested;
            return report;
        }

        return client.$transaction(async (tx) => {
            const report = await this.plan(parsed.map!, { ...options, dryRun: false }, tx, parsed.fingerprint);
            report.issues.unshift(...parsed.issues);
            if (!report.valid || !options.userId) throw new CatalogCostImportError(report);
            await this.applyPlan(tx, report, options.userId);
            const verification = await this.plan(parsed.map!, { ...options, dryRun: false }, tx, parsed.fingerprint);
            if (!verification.valid || verification.summary.creates > 0 || verification.summary.updates > 0) {
                verification.issues.push(issue(
                    'ERROR',
                    'POSTCONDITION_FAILED',
                    '$',
                    'La segunda planificación no fue un no-op; se revierte la transacción.'
                ));
                verification.valid = false;
                throw new CatalogCostImportError(verification);
            }
            report.applied = true;
            return report;
        }, {
            isolationLevel: 'Serializable',
            // A full catalog import can legitimately execute hundreds of
            // product, ProductUnit and AuditLog writes over Railway's public
            // connection. Keep it atomic, but allow enough time for the
            // postcondition pass to finish instead of timing out mid-import.
            maxWait: 30_000,
            timeout: 300_000
        });
    }
}
