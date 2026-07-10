import { createHash } from 'crypto';
import type { Prisma, ProductType, StorageType } from '@prisma/client';

import prisma from '../utils/prisma';

type CatalogDb = Prisma.TransactionClient | typeof prisma;

export type RecipeCatalogIssueSeverity = 'ERROR' | 'WARNING';
export type RecipeCatalogEntryMode = 'EXISTING' | 'CREATE';
export type RecipeCatalogActionKind = 'CREATE' | 'UPDATE' | 'UNCHANGED';

export interface RecipeCatalogIssue {
    severity: RecipeCatalogIssueSeverity;
    code: string;
    path: string;
    message: string;
    context?: Record<string, unknown>;
}

export interface RecipeCatalogMapEntry {
    sourceName: string;
    productSku: string;
    mode: RecipeCatalogEntryMode;
    catalogName: string;
    baseUnit: string;
    recipeUnits?: string[];
    productType: ProductType;
    storageType?: StorageType | null;
    referenceCost?: number | null;
    activate: boolean;
    recipeUnitOverride?: { from: string; to: string; evidence: string } | null;
}

export interface RecipeCatalogMap {
    schemaVersion: 1;
    source: { file: string; sha256: string };
    defaultCategory: string;
    entries: RecipeCatalogMapEntry[];
}

export interface PlannedRecipeCatalogAction {
    sourceName: string;
    productSku: string;
    catalogName: string;
    mode: RecipeCatalogEntryMode;
    action: RecipeCatalogActionKind;
    productId: number | null;
    baseUnitId: number;
    baseUnit: string;
    categoryId: number | null;
    productType: ProductType;
    storageType: StorageType | null;
    referenceCost: number | null;
    update: { active?: boolean; type?: ProductType };
    ensureProductUnits: Array<{
        unitId: number;
        abbreviation: string;
        conversionFactor: number;
        isDefault: boolean;
    }>;
}

export interface RecipeCatalogPreparationReport {
    valid: boolean;
    applied: boolean;
    dryRun: boolean;
    companyId: number;
    userId: number | null;
    fingerprint: string;
    source: RecipeCatalogMap['source'] | null;
    summary: { entries: number; creates: number; updates: number; unchanged: number };
    issues: RecipeCatalogIssue[];
    actions: PlannedRecipeCatalogAction[];
}

export interface RecipeCatalogPreparationOptions {
    companyId: number;
    userId?: number | null;
    dryRun?: boolean;
    client?: typeof prisma;
}

type ParsedMap = {
    map: RecipeCatalogMap | null;
    issues: RecipeCatalogIssue[];
    fingerprint: string;
};

type ProductRow = {
    id: number;
    sku: string | null;
    name: string;
    active: boolean;
    type: ProductType;
    unit: string;
    baseUnitId: number | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned || null;
}

function normalizeCode(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeText(value: string): string {
    return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function fingerprint(value: unknown): string {
    const canonical = (current: unknown): string => {
        if (Array.isArray(current)) return `[${current.map(canonical).join(',')}]`;
        if (isRecord(current)) {
            return `{${Object.keys(current).sort().map((key) => `${JSON.stringify(key)}:${canonical(current[key])}`).join(',')}}`;
        }
        return JSON.stringify(current) ?? JSON.stringify(String(current));
    };
    return createHash('sha256').update(canonical(value)).digest('hex');
}

function issue(
    severity: RecipeCatalogIssueSeverity,
    code: string,
    path: string,
    message: string,
    context?: Record<string, unknown>
): RecipeCatalogIssue {
    return { severity, code, path, message, ...(context ? { context } : {}) };
}

export function parseRecipeCatalogMap(input: unknown): ParsedMap {
    const issues: RecipeCatalogIssue[] = [];
    const inputFingerprint = fingerprint(input);
    if (!isRecord(input)) {
        return {
            map: null,
            issues: [issue('ERROR', 'DOCUMENT_INVALID', '$', 'El mapa de catálogo debe ser un objeto.')],
            fingerprint: inputFingerprint
        };
    }
    if (input.schemaVersion !== 1) {
        issues.push(issue('ERROR', 'SCHEMA_VERSION_UNSUPPORTED', '$.schemaVersion', 'schemaVersion debe ser 1.'));
    }

    const sourceRaw = input.source;
    const sourceFile = isRecord(sourceRaw) ? cleanString(sourceRaw.file) : null;
    const sourceSha256 = isRecord(sourceRaw) ? cleanString(sourceRaw.sha256) : null;
    if (!sourceFile) issues.push(issue('ERROR', 'SOURCE_FILE_REQUIRED', '$.source.file', 'source.file es requerido.'));
    if (!sourceSha256 || !/^[a-f0-9]{64}$/i.test(sourceSha256)) {
        issues.push(issue('ERROR', 'SOURCE_SHA256_INVALID', '$.source.sha256', 'source.sha256 debe ser un SHA-256 hexadecimal.'));
    }

    const defaultCategory = cleanString(input.defaultCategory);
    if (!defaultCategory) {
        issues.push(issue('ERROR', 'DEFAULT_CATEGORY_REQUIRED', '$.defaultCategory', 'defaultCategory es requerido.'));
    }
    if (!Array.isArray(input.entries) || input.entries.length === 0) {
        issues.push(issue('ERROR', 'ENTRIES_INVALID', '$.entries', 'entries debe ser un arreglo no vacío.'));
    }

    const entries: RecipeCatalogMapEntry[] = [];
    const names = new Set<string>();
    const skus = new Set<string>();
    const rawEntries = Array.isArray(input.entries) ? input.entries : [];
    rawEntries.forEach((rawEntry, index) => {
        const path = `$.entries[${index}]`;
        if (!isRecord(rawEntry)) {
            issues.push(issue('ERROR', 'ENTRY_INVALID', path, 'La entrada debe ser un objeto.'));
            return;
        }
        const sourceName = cleanString(rawEntry.sourceName);
        const productSku = cleanString(rawEntry.productSku);
        const catalogName = cleanString(rawEntry.catalogName);
        const baseUnit = cleanString(rawEntry.baseUnit)?.toLocaleLowerCase('es') ?? null;
        const mode = rawEntry.mode === 'EXISTING' || rawEntry.mode === 'CREATE' ? rawEntry.mode : null;
        const productType = typeof rawEntry.productType === 'string' && PRODUCT_TYPES.has(rawEntry.productType as ProductType)
            ? rawEntry.productType as ProductType
            : null;
        const storageType = rawEntry.storageType === undefined || rawEntry.storageType === null
            ? null
            : typeof rawEntry.storageType === 'string' && STORAGE_TYPES.has(rawEntry.storageType as StorageType)
                ? rawEntry.storageType as StorageType
                : undefined;
        const activate = rawEntry.activate;
        const recipeUnits: string[] = [];
        if (rawEntry.recipeUnits !== undefined) {
            if (!Array.isArray(rawEntry.recipeUnits)) {
                issues.push(issue('ERROR', 'RECIPE_UNITS_INVALID', `${path}.recipeUnits`, 'recipeUnits debe ser un arreglo de abreviaturas.'));
            } else {
                rawEntry.recipeUnits.forEach((rawUnit, unitIndex) => {
                    const parsedUnit = cleanString(rawUnit)?.toLocaleLowerCase('es') ?? null;
                    if (!parsedUnit) {
                        issues.push(issue('ERROR', 'RECIPE_UNIT_INVALID', `${path}.recipeUnits[${unitIndex}]`, 'La abreviatura no puede estar vacía.'));
                    } else if (!recipeUnits.includes(parsedUnit)) recipeUnits.push(parsedUnit);
                });
            }
        }
        const referenceCost = rawEntry.referenceCost === undefined || rawEntry.referenceCost === null
            ? null
            : typeof rawEntry.referenceCost === 'number' && Number.isFinite(rawEntry.referenceCost) && rawEntry.referenceCost >= 0
                ? rawEntry.referenceCost
                : undefined;

        if (!sourceName) issues.push(issue('ERROR', 'SOURCE_NAME_REQUIRED', `${path}.sourceName`, 'sourceName es requerido.'));
        if (!productSku) issues.push(issue('ERROR', 'PRODUCT_SKU_REQUIRED', `${path}.productSku`, 'productSku es requerido.'));
        if (!catalogName) issues.push(issue('ERROR', 'CATALOG_NAME_REQUIRED', `${path}.catalogName`, 'catalogName es requerido.'));
        if (!baseUnit) issues.push(issue('ERROR', 'BASE_UNIT_REQUIRED', `${path}.baseUnit`, 'baseUnit es requerido.'));
        if (!mode) issues.push(issue('ERROR', 'MODE_INVALID', `${path}.mode`, 'mode debe ser EXISTING o CREATE.'));
        if (!productType) issues.push(issue('ERROR', 'PRODUCT_TYPE_INVALID', `${path}.productType`, 'productType no es válido.'));
        if (storageType === undefined) issues.push(issue('ERROR', 'STORAGE_TYPE_INVALID', `${path}.storageType`, 'storageType no es válido.'));
        if (referenceCost === undefined) issues.push(issue('ERROR', 'REFERENCE_COST_INVALID', `${path}.referenceCost`, 'referenceCost debe ser un número no negativo.'));
        if (activate !== true) issues.push(issue('ERROR', 'ACTIVATE_REQUIRED', `${path}.activate`, 'Las entradas de receta deben quedar activas.'));
        if (mode === 'CREATE' && referenceCost === null) {
            issues.push(issue('ERROR', 'REFERENCE_COST_REQUIRED', `${path}.referenceCost`, 'referenceCost es requerido al crear un producto.'));
        }

        let recipeUnitOverride: RecipeCatalogMapEntry['recipeUnitOverride'] = null;
        if (rawEntry.recipeUnitOverride !== undefined && rawEntry.recipeUnitOverride !== null) {
            const rawOverride = rawEntry.recipeUnitOverride;
            const from = isRecord(rawOverride) ? cleanString(rawOverride.from) : null;
            const to = isRecord(rawOverride) ? cleanString(rawOverride.to) : null;
            const evidence = isRecord(rawOverride) ? cleanString(rawOverride.evidence) : null;
            if (!from || !to || !evidence) {
                issues.push(issue('ERROR', 'UNIT_OVERRIDE_INVALID', `${path}.recipeUnitOverride`, 'La corrección requiere from, to y evidence.'));
            } else recipeUnitOverride = { from, to, evidence };
        }

        if (!sourceName || !productSku || !catalogName || !baseUnit || !mode || !productType
            || storageType === undefined || referenceCost === undefined || activate !== true) return;
        const normalizedName = normalizeText(sourceName);
        const normalizedSku = normalizeCode(productSku);
        if (names.has(normalizedName)) issues.push(issue('ERROR', 'SOURCE_NAME_DUPLICATE', `${path}.sourceName`, `sourceName duplicado: ${sourceName}.`));
        if (skus.has(normalizedSku)) issues.push(issue('ERROR', 'PRODUCT_SKU_DUPLICATE', `${path}.productSku`, `productSku duplicado: ${productSku}.`));
        names.add(normalizedName);
        skus.add(normalizedSku);
        entries.push({
            sourceName,
            productSku,
            mode,
            catalogName,
            baseUnit,
            recipeUnits,
            productType,
            storageType,
            referenceCost,
            activate: true,
            recipeUnitOverride
        });
    });

    const map = sourceFile && sourceSha256 && defaultCategory
        ? { schemaVersion: 1 as const, source: { file: sourceFile, sha256: sourceSha256 }, defaultCategory, entries }
        : null;
    return { map, issues, fingerprint: inputFingerprint };
}

export class RecipeCatalogPreparationError extends Error {
    constructor(public readonly report: RecipeCatalogPreparationReport) {
        super('La preparación del catálogo no superó la validación.');
        this.name = 'RecipeCatalogPreparationError';
    }
}

function emptyReport(parsed: ParsedMap, options: RecipeCatalogPreparationOptions): RecipeCatalogPreparationReport {
    return {
        valid: false,
        applied: false,
        dryRun: options.dryRun !== false,
        companyId: options.companyId,
        userId: options.userId ?? null,
        fingerprint: parsed.fingerprint,
        source: parsed.map?.source ?? null,
        summary: { entries: parsed.map?.entries.length ?? 0, creates: 0, updates: 0, unchanged: 0 },
        issues: [...parsed.issues],
        actions: []
    };
}

export class RecipeCatalogPreparationService {
    static async listValidAuditUsers(companyId: number, db: CatalogDb = prisma): Promise<Array<{ id: number; name: string }>> {
        return db.user.findMany({
            where: { companyId, status: 'ACTIVE' },
            select: { id: true, name: true },
            orderBy: { id: 'asc' }
        });
    }

    static async plan(
        map: RecipeCatalogMap,
        options: RecipeCatalogPreparationOptions,
        db: CatalogDb = prisma,
        inputFingerprint = fingerprint(map)
    ): Promise<RecipeCatalogPreparationReport> {
        const report: RecipeCatalogPreparationReport = {
            valid: false,
            applied: false,
            dryRun: options.dryRun !== false,
            companyId: options.companyId,
            userId: options.userId ?? null,
            fingerprint: inputFingerprint,
            source: map.source,
            summary: { entries: map.entries.length, creates: 0, updates: 0, unchanged: 0 },
            issues: [],
            actions: []
        };
        if (!Number.isInteger(options.companyId) || options.companyId <= 0) {
            report.issues.push(issue('ERROR', 'COMPANY_ID_INVALID', '$options.companyId', 'companyId debe ser un entero positivo.'));
            return report;
        }
        const company = await db.company.findFirst({
            where: { id: options.companyId, active: true },
            select: { id: true, name: true }
        });
        if (!company) {
            report.issues.push(issue('ERROR', 'COMPANY_NOT_FOUND', '$options.companyId', `No existe una empresa activa con id ${options.companyId}.`));
            return report;
        }
        if (options.dryRun === false) {
            const users = await this.listValidAuditUsers(options.companyId, db);
            if (!options.userId || !users.some((user) => user.id === options.userId)) {
                report.issues.push(issue(
                    'ERROR',
                    options.userId ? 'AUDIT_USER_INVALID' : 'AUDIT_USER_REQUIRED',
                    '$options.userId',
                    'Se requiere un usuario activo de la empresa para registrar AuditLog.',
                    { validUsers: users }
                ));
                return report;
            }
        }

        const [products, units, categories] = await Promise.all([
            db.product.findMany({
                where: { companyId: options.companyId, sku: { in: map.entries.map((entry) => entry.productSku) } },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    active: true,
                    type: true,
                    unit: true,
                    baseUnitId: true,
                    allowedUnits: {
                        select: { unitId: true, conversionFactor: true, isDefault: true, active: true }
                    }
                }
            }) as unknown as Promise<ProductRow[]>,
            db.unitOfMeasure.findMany({
                where: {
                    companyId: options.companyId,
                    abbreviation: {
                        in: [...new Set(map.entries.flatMap((entry) => [entry.baseUnit, ...(entry.recipeUnits ?? [])]))]
                    }
                },
                select: { id: true, abbreviation: true, measurementType: true, systemFactor: true, active: true }
            }) as unknown as Promise<UnitRow[]>,
            db.category.findMany({
                where: { companyId: options.companyId, name: map.defaultCategory },
                select: { id: true, name: true, active: true }
            }) as unknown as Promise<CategoryRow[]>
        ]);
        const productBySku = new Map(products.map((product) => [normalizeCode(product.sku ?? ''), product]));
        const unitByAbbreviation = new Map(units.map((unit) => [unit.abbreviation.toLocaleLowerCase('es'), unit]));
        const category = categories.find((candidate) => candidate.active) ?? null;

        for (let index = 0; index < map.entries.length; index++) {
            const entry = map.entries[index];
            const path = `$.entries[${index}]`;
            const unit = unitByAbbreviation.get(entry.baseUnit.toLocaleLowerCase('es'));
            if (!unit || !unit.active) {
                report.issues.push(issue('ERROR', 'BASE_UNIT_NOT_FOUND', `${path}.baseUnit`, `No existe la unidad activa ${entry.baseUnit}.`));
                continue;
            }
            const requiredProductUnits: PlannedRecipeCatalogAction['ensureProductUnits'] = [{
                unitId: unit.id,
                abbreviation: unit.abbreviation,
                conversionFactor: 1,
                isDefault: true
            }];
            let recipeUnitInvalid = false;
            for (let unitIndex = 0; unitIndex < (entry.recipeUnits ?? []).length; unitIndex++) {
                const abbreviation = entry.recipeUnits![unitIndex];
                const recipeUnit = unitByAbbreviation.get(abbreviation.toLocaleLowerCase('es'));
                if (!recipeUnit || !recipeUnit.active) {
                    report.issues.push(issue('ERROR', 'RECIPE_UNIT_NOT_FOUND', `${path}.recipeUnits[${unitIndex}]`, `No existe la unidad activa ${abbreviation}.`));
                    recipeUnitInvalid = true;
                    continue;
                }
                if (recipeUnit.measurementType !== unit.measurementType) {
                    report.issues.push(issue(
                        'ERROR',
                        'RECIPE_UNIT_INCOMPATIBLE',
                        `${path}.recipeUnits[${unitIndex}]`,
                        `${recipeUnit.abbreviation} (${recipeUnit.measurementType}) no es compatible con la base ${unit.abbreviation} (${unit.measurementType}).`
                    ));
                    recipeUnitInvalid = true;
                    continue;
                }
                if (recipeUnit.id !== unit.id) {
                    requiredProductUnits.push({
                        unitId: recipeUnit.id,
                        abbreviation: recipeUnit.abbreviation,
                        conversionFactor: Number(recipeUnit.systemFactor) / Number(unit.systemFactor),
                        isDefault: false
                    });
                }
            }
            if (recipeUnitInvalid) continue;
            const product = productBySku.get(normalizeCode(entry.productSku));
            if (entry.mode === 'EXISTING' && !product) {
                report.issues.push(issue('ERROR', 'EXISTING_PRODUCT_NOT_FOUND', `${path}.productSku`, `No existe el SKU requerido ${entry.productSku}.`));
                continue;
            }
            if (entry.mode === 'CREATE' && !product && !category) {
                report.issues.push(issue('ERROR', 'DEFAULT_CATEGORY_NOT_FOUND', '$.defaultCategory', `No existe la categoría activa ${map.defaultCategory}.`));
                continue;
            }

            if (!product) {
                report.actions.push({
                    sourceName: entry.sourceName,
                    productSku: entry.productSku,
                    catalogName: entry.catalogName,
                    mode: entry.mode,
                    action: 'CREATE',
                    productId: null,
                    baseUnitId: unit.id,
                    baseUnit: unit.abbreviation,
                    categoryId: category!.id,
                    productType: entry.productType,
                    storageType: entry.storageType ?? null,
                    referenceCost: entry.referenceCost ?? null,
                    update: {},
                    ensureProductUnits: requiredProductUnits
                });
                report.summary.creates++;
                continue;
            }

            if (product.baseUnitId !== unit.id || normalizeText(product.unit) !== normalizeText(unit.abbreviation)) {
                report.issues.push(issue(
                    'ERROR',
                    'BASE_UNIT_MISMATCH',
                    `${path}.baseUnit`,
                    `El SKU ${entry.productSku} usa ${product.unit}/baseUnitId=${product.baseUnitId}, no ${unit.abbreviation}/id=${unit.id}.`,
                    { productId: product.id }
                ));
                continue;
            }
            if (entry.mode === 'CREATE'
                && (normalizeText(product.name) !== normalizeText(entry.catalogName) || product.type !== entry.productType)) {
                report.issues.push(issue(
                    'ERROR',
                    'MANAGED_PRODUCT_CONFLICT',
                    `${path}.productSku`,
                    `El SKU administrado ${entry.productSku} ya existe con nombre o tipo incompatible.`,
                    { productId: product.id, actualName: product.name, actualType: product.type }
                ));
                continue;
            }

            const update: PlannedRecipeCatalogAction['update'] = {};
            if (!product.active) update.active = true;
            if (entry.mode === 'EXISTING' && product.type !== entry.productType) update.type = entry.productType;
            const ensureProductUnits = requiredProductUnits.filter((required) => {
                const configured = product.allowedUnits.find((allowed) => allowed.unitId === required.unitId);
                return !configured
                    || !configured.active
                    || configured.isDefault !== required.isDefault
                    || Math.abs(Number(configured.conversionFactor) - required.conversionFactor) > 0.0000005;
            });
            const action: RecipeCatalogActionKind = Object.keys(update).length > 0 || ensureProductUnits.length > 0 ? 'UPDATE' : 'UNCHANGED';
            report.actions.push({
                sourceName: entry.sourceName,
                productSku: entry.productSku,
                catalogName: entry.catalogName,
                mode: entry.mode,
                action,
                productId: product.id,
                baseUnitId: unit.id,
                baseUnit: unit.abbreviation,
                categoryId: null,
                productType: entry.productType,
                storageType: entry.storageType ?? null,
                referenceCost: entry.referenceCost ?? null,
                update,
                ensureProductUnits
            });
            if (action === 'UPDATE') report.summary.updates++;
            else report.summary.unchanged++;
        }

        report.valid = !report.issues.some((entry) => entry.severity === 'ERROR')
            && report.actions.length === map.entries.length;
        return report;
    }

    private static async applyPlan(
        tx: Prisma.TransactionClient,
        report: RecipeCatalogPreparationReport,
        userId: number
    ): Promise<void> {
        for (const action of report.actions) {
            if (action.action === 'UNCHANGED') continue;
            let productId = action.productId;
            if (action.action === 'CREATE') {
                const created = await tx.product.create({
                    data: {
                        companyId: report.companyId,
                        name: action.catalogName,
                        sku: action.productSku,
                        categoryId: action.categoryId,
                        unit: action.baseUnit,
                        baseUnitId: action.baseUnitId,
                        minStock: 0,
                        cost: Number((action.referenceCost ?? 0).toFixed(2)),
                        currentAverageCost: action.referenceCost ?? 0,
                        lastPurchaseCost: 0,
                        type: action.productType,
                        storageType: action.storageType,
                        observation: `Creado para recetas desde ${report.source?.file ?? 'fuente normalizada'}; `
                            + `SHA-256 ${report.source?.sha256 ?? 'N/D'}. Sin inventario inicial; costo referencial del archivo fuente.`,
                        active: true
                    }
                });
                productId = created.id;
            } else if (productId && Object.keys(action.update).length > 0) {
                await tx.product.update({ where: { id: productId }, data: action.update });
            }
            if (!productId) throw new Error(`No se pudo determinar productId para ${action.productSku}.`);
            for (const productUnit of action.ensureProductUnits) {
                await tx.productUnit.upsert({
                    where: { productId_unitId: { productId, unitId: productUnit.unitId } },
                    update: {
                        conversionFactor: productUnit.conversionFactor,
                        isDefault: productUnit.isDefault,
                        active: true
                    },
                    create: {
                        companyId: report.companyId,
                        productId,
                        unitId: productUnit.unitId,
                        conversionFactor: productUnit.conversionFactor,
                        isDefault: productUnit.isDefault,
                        active: true
                    }
                });
            }
            await tx.auditLog.create({
                data: {
                    companyId: report.companyId,
                    userId,
                    entityType: 'Product',
                    entityId: productId,
                    action: 'IMPORT',
                    details: {
                        source: report.source,
                        mapFingerprint: report.fingerprint,
                        catalogPreparation: true,
                        sourceName: action.sourceName,
                        productSku: action.productSku,
                        action: action.action,
                        update: action.update,
                        ensuredUnits: action.ensureProductUnits.map((unit) => ({
                            abbreviation: unit.abbreviation,
                            conversionFactor: unit.conversionFactor,
                            isDefault: unit.isDefault
                        })),
                        referenceCost: action.action === 'CREATE' ? action.referenceCost : null
                    } as Prisma.InputJsonValue
                }
            });
        }
    }

    static async prepare(input: unknown, options: RecipeCatalogPreparationOptions): Promise<RecipeCatalogPreparationReport> {
        const parsed = parseRecipeCatalogMap(input);
        const base = emptyReport(parsed, options);
        if (!parsed.map || parsed.issues.some((entry) => entry.severity === 'ERROR')) return base;
        const client = options.client ?? prisma;
        if (options.dryRun !== false) {
            const report = await this.plan(parsed.map, { ...options, dryRun: true }, client, parsed.fingerprint);
            report.issues.unshift(...parsed.issues);
            report.valid = !report.issues.some((entry) => entry.severity === 'ERROR');
            return report;
        }

        return client.$transaction(async (tx) => {
            const report = await this.plan(parsed.map!, { ...options, dryRun: false }, tx, parsed.fingerprint);
            report.issues.unshift(...parsed.issues);
            if (!report.valid || !options.userId) throw new RecipeCatalogPreparationError(report);
            await this.applyPlan(tx, report, options.userId);
            const verification = await this.plan(parsed.map!, { ...options, dryRun: false }, tx, parsed.fingerprint);
            if (!verification.valid || verification.summary.creates > 0 || verification.summary.updates > 0) {
                verification.issues.push(issue('ERROR', 'POSTCONDITION_FAILED', '$', 'La segunda planificación no fue un no-op; se revierte la transacción.'));
                verification.valid = false;
                throw new RecipeCatalogPreparationError(verification);
            }
            report.applied = true;
            return report;
        }, {
            isolationLevel: 'Serializable',
            maxWait: 10_000,
            timeout: 120_000
        });
    }
}
