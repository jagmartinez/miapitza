import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';

import prisma from '../utils/prisma';
import type { MenuRecipeImportIssue } from '../services/menu-recipe-import.service';
import type { ReviewedMenuItemDefinition } from './prepare-reviewed-recipes';

type ImportDb = Prisma.TransactionClient | typeof prisma;

type ReviewedMenuItemDocument = {
    schemaVersion: 1;
    source: { file: string; sha256?: string | null };
    fingerprint: string;
    menuItems: ReviewedMenuItemDefinition[];
};

type MenuItemAction = {
    sourceKey: string;
    action: 'CREATE' | 'UPDATE' | 'UNCHANGED';
    menuItemId: number | null;
    name: string;
    categoryId: number;
    category: string;
    brandId: number | null;
    brand: string | null;
    type: 'PREPARED' | 'DIRECT';
    price: number;
    description: string;
    changes: Record<string, { before: unknown; after: unknown }>;
};

type MenuItemPreparationReport = {
    valid: boolean;
    applied: boolean;
    dryRun: boolean;
    companyId: number;
    userId: number | null;
    fingerprint: string;
    source: ReviewedMenuItemDocument['source'] | null;
    summary: { entries: number; creates: number; updates: number; unchanged: number };
    issues: MenuRecipeImportIssue[];
    actions: MenuItemAction[];
};

type CliOptions = {
    file: string;
    companyId: number | null;
    userId: number | null;
    apply: boolean;
    report: string | null;
};

const DEFAULT_FILE = path.resolve(__dirname, '../../prisma/data/recetas-menu.review-menu-items.json');

function clean(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function sameMoney(left: unknown, right: number): boolean {
    return Math.abs(Number(left) - right) <= 0.0049;
}

function issue(
    code: string,
    issuePath: string,
    message: string,
    context?: Record<string, unknown>
): MenuRecipeImportIssue {
    return { severity: 'ERROR', code, path: issuePath, message, ...(context ? { context } : {}) };
}

function fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validateReviewedMenuItemDocument(input: unknown): {
    document: ReviewedMenuItemDocument | null;
    issues: MenuRecipeImportIssue[];
} {
    const issues: MenuRecipeImportIssue[] = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { document: null, issues: [issue('REVIEW_MENU_DOCUMENT_INVALID', '$', 'El documento debe ser un objeto.')] };
    }
    const value = input as Record<string, unknown>;
    if (value.schemaVersion !== 1) issues.push(issue('REVIEW_MENU_VERSION_UNSUPPORTED', '$.schemaVersion', 'schemaVersion debe ser 1.'));
    const source = value.source as Record<string, unknown> | undefined;
    if (!source || !clean(source.file) || !clean(source.sha256)) {
        issues.push(issue('REVIEW_MENU_SOURCE_INVALID', '$.source', 'source.file y source.sha256 son obligatorios.'));
    }
    if (!clean(value.fingerprint)) issues.push(issue('REVIEW_MENU_FINGERPRINT_REQUIRED', '$.fingerprint', 'fingerprint es obligatorio.'));
    if (!Array.isArray(value.menuItems) || value.menuItems.length === 0) {
        issues.push(issue('REVIEW_MENU_ITEMS_REQUIRED', '$.menuItems', 'menuItems debe contener definiciones.'));
    }
    const names = new Set<string>();
    const sourceKeys = new Set<string>();
    (Array.isArray(value.menuItems) ? value.menuItems : []).forEach((raw, index) => {
        const item = raw as Partial<ReviewedMenuItemDefinition>;
        const itemPath = `$.menuItems[${index}]`;
        if (!clean(item.sourceKey) || !clean(item.name) || !clean(item.category) || !clean(item.description)) {
            issues.push(issue('REVIEW_MENU_ITEM_INCOMPLETE', itemPath, 'sourceKey, name, category y description son obligatorios.'));
        }
        if (item.brand !== null && item.brand !== undefined && !clean(item.brand)) {
            issues.push(issue('REVIEW_MENU_BRAND_INVALID', `${itemPath}.brand`, 'brand debe ser texto no vacío o null.'));
        }
        if (!['PREPARED', 'DIRECT'].includes(item.type ?? '')) {
            issues.push(issue('REVIEW_MENU_TYPE_INVALID', `${itemPath}.type`, 'type debe ser PREPARED o DIRECT.'));
        }
        if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0) {
            issues.push(issue('REVIEW_MENU_PRICE_INVALID', `${itemPath}.price`, 'price debe ser mayor que cero.'));
        }
        if (clean(item.name)) {
            const key = normalize(item.name!);
            if (names.has(key)) issues.push(issue('REVIEW_MENU_NAME_DUPLICATE', `${itemPath}.name`, `Nombre duplicado: ${item.name}.`));
            names.add(key);
        }
        if (clean(item.sourceKey)) {
            if (sourceKeys.has(item.sourceKey!)) issues.push(issue('REVIEW_MENU_SOURCE_KEY_DUPLICATE', `${itemPath}.sourceKey`, `sourceKey duplicado: ${item.sourceKey}.`));
            sourceKeys.add(item.sourceKey!);
        }
    });
    return issues.length === 0
        ? { document: input as ReviewedMenuItemDocument, issues }
        : { document: null, issues };
}

async function plan(
    document: ReviewedMenuItemDocument,
    options: { companyId: number; userId: number | null; dryRun: boolean },
    db: ImportDb
): Promise<MenuItemPreparationReport> {
    const report: MenuItemPreparationReport = {
        valid: false,
        applied: false,
        dryRun: options.dryRun,
        companyId: options.companyId,
        userId: options.userId,
        fingerprint: fingerprint(document),
        source: document.source,
        summary: { entries: document.menuItems.length, creates: 0, updates: 0, unchanged: 0 },
        issues: [],
        actions: []
    };
    const company = await db.company.findFirst({ where: { id: options.companyId, active: true }, select: { id: true } });
    if (!company) {
        report.issues.push(issue('COMPANY_NOT_FOUND', '$options.companyId', `No existe empresa activa ${options.companyId}.`));
        return report;
    }
    if (!options.dryRun) {
        const user = options.userId
            ? await db.user.findFirst({ where: { id: options.userId, companyId: options.companyId, status: 'ACTIVE' }, select: { id: true } })
            : null;
        if (!user) {
            report.issues.push(issue('AUDIT_USER_INVALID', '$options.userId', 'Se requiere un usuario activo de la empresa.'));
            return report;
        }
    }

    const categoryNames = [...new Set(document.menuItems.map((item) => item.category))];
    const brandNames = [...new Set(document.menuItems.map((item) => item.brand).filter((name): name is string => Boolean(name)))];
    const itemNames = [...new Set(document.menuItems.map((item) => item.name))];
    const [categories, brands, existing] = await Promise.all([
        db.category.findMany({
            where: { companyId: options.companyId, active: true, name: { in: categoryNames } },
            select: { id: true, name: true }
        }),
        db.menuBrand.findMany({
            where: { companyId: options.companyId, active: true, name: { in: brandNames } },
            select: { id: true, name: true }
        }),
        db.menuItem.findMany({
            where: { companyId: options.companyId, name: { in: itemNames } },
            select: {
                id: true,
                name: true,
                categoryId: true,
                brandId: true,
                branchId: true,
                price: true,
                description: true,
                type: true,
                active: true
            }
        })
    ]);
    const categoriesByName = new Map(categories.map((item) => [normalize(item.name), item]));
    const brandsByName = new Map(brands.map((item) => [normalize(item.name), item]));
    const existingByName = new Map<string, typeof existing>();
    existing.forEach((item) => {
        const key = normalize(item.name);
        existingByName.set(key, [...(existingByName.get(key) ?? []), item]);
    });

    document.menuItems.forEach((item, index) => {
        const itemPath = `$.menuItems[${index}]`;
        const category = categoriesByName.get(normalize(item.category));
        if (!category) {
            report.issues.push(issue('MENU_CATEGORY_NOT_FOUND', `${itemPath}.category`, `No existe categoría activa ${item.category}.`));
            return;
        }
        const brand = item.brand ? brandsByName.get(normalize(item.brand)) : null;
        if (item.brand && !brand) {
            report.issues.push(issue('MENU_BRAND_NOT_FOUND', `${itemPath}.brand`, `No existe marca activa ${item.brand}.`));
            return;
        }
        const candidates = existingByName.get(normalize(item.name)) ?? [];
        if (candidates.length > 1) {
            report.issues.push(issue('MENU_ITEM_AMBIGUOUS', `${itemPath}.name`, `Hay ${candidates.length} platos llamados ${item.name}.`));
            return;
        }
        const current = candidates[0] ?? null;
        const changes: MenuItemAction['changes'] = {};
        if (current) {
            const desired = {
                categoryId: category.id,
                brandId: brand?.id ?? null,
                branchId: null,
                price: item.price,
                description: item.description,
                type: item.type,
                active: true
            };
            for (const [field, after] of Object.entries(desired)) {
                const before = current[field as keyof typeof current];
                const equal = field === 'price' ? sameMoney(before, item.price) : before === after;
                if (!equal) changes[field] = { before, after };
            }
        }
        const action: MenuItemAction['action'] = !current ? 'CREATE' : Object.keys(changes).length > 0 ? 'UPDATE' : 'UNCHANGED';
        report.actions.push({
            sourceKey: item.sourceKey,
            action,
            menuItemId: current?.id ?? null,
            name: item.name,
            categoryId: category.id,
            category: category.name,
            brandId: brand?.id ?? null,
            brand: brand?.name ?? null,
            type: item.type,
            price: item.price,
            description: item.description,
            changes
        });
        if (action === 'CREATE') report.summary.creates++;
        else if (action === 'UPDATE') report.summary.updates++;
        else report.summary.unchanged++;
    });
    report.valid = report.issues.length === 0 && report.actions.length === document.menuItems.length;
    return report;
}

async function applyPlan(tx: Prisma.TransactionClient, report: MenuItemPreparationReport, userId: number): Promise<void> {
    for (const action of report.actions) {
        let menuItemId = action.menuItemId;
        if (action.action === 'CREATE') {
            const created = await tx.menuItem.create({
                data: {
                    companyId: report.companyId,
                    branchId: null,
                    brandId: action.brandId,
                    categoryId: action.categoryId,
                    name: action.name,
                    description: action.description,
                    price: action.price,
                    active: true,
                    type: action.type
                }
            });
            menuItemId = created.id;
        } else if (action.action === 'UPDATE' && menuItemId) {
            await tx.menuItem.update({
                where: { id: menuItemId },
                data: {
                    branchId: null,
                    brandId: action.brandId,
                    categoryId: action.categoryId,
                    description: action.description,
                    price: action.price,
                    active: true,
                    type: action.type
                }
            });
        }
        if (!menuItemId) throw new Error(`No se determinó menuItemId para ${action.name}.`);
        if (action.action !== 'UNCHANGED') {
            await tx.auditLog.create({
                data: {
                    companyId: report.companyId,
                    userId,
                    entityType: 'MenuItem',
                    entityId: menuItemId,
                    action: 'IMPORT',
                    details: {
                        reviewedRecipeImport: true,
                        source: report.source,
                        sourceKey: action.sourceKey,
                        fingerprint: report.fingerprint,
                        action: action.action,
                        changes: action.changes,
                        price: action.price,
                        category: action.category,
                        brand: action.brand,
                        type: action.type
                    } as Prisma.InputJsonValue
                }
            });
        }
    }
}

function readValue(args: string[], index: number, flag: string): { value: string; index: number } {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return { value, index: index + 1 };
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = { file: DEFAULT_FILE, companyId: null, userId: null, apply: false, report: null };
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (flag === '--file') {
            const read = readValue(args, index, flag); options.file = path.resolve(read.value); index = read.index;
        } else if (flag === '--company-id') {
            const read = readValue(args, index, flag); options.companyId = Number(read.value); index = read.index;
        } else if (flag === '--user-id') {
            const read = readValue(args, index, flag); options.userId = Number(read.value); index = read.index;
        } else if (flag === '--report') {
            const read = readValue(args, index, flag); options.report = path.resolve(read.value); index = read.index;
        } else if (flag === '--apply') options.apply = true;
        else if (flag === '--dry-run') options.apply = false;
        else throw new Error(`Opción desconocida: ${flag}`);
    }
    if (!Number.isInteger(options.companyId) || options.companyId! <= 0) throw new Error('--company-id es obligatorio y debe ser positivo.');
    if (options.apply && (!Number.isInteger(options.userId) || options.userId! <= 0)) throw new Error('--user-id es obligatorio con --apply.');
    return options;
}

async function emit(report: MenuItemPreparationReport, reportFile: string | null): Promise<void> {
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(rendered);
    if (reportFile) await writeFile(reportFile, rendered, 'utf8');
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const parsed = validateReviewedMenuItemDocument(JSON.parse(await readFile(options.file, 'utf8')));
    if (!parsed.document) {
        await emit({
            valid: false,
            applied: false,
            dryRun: !options.apply,
            companyId: options.companyId!,
            userId: options.userId,
            fingerprint: '',
            source: null,
            summary: { entries: 0, creates: 0, updates: 0, unchanged: 0 },
            issues: parsed.issues,
            actions: []
        }, options.report);
        process.exitCode = 1;
        return;
    }
    if (!options.apply) {
        const report = await plan(parsed.document, { companyId: options.companyId!, userId: null, dryRun: true }, prisma);
        await emit(report, options.report);
        if (!report.valid) process.exitCode = 1;
        return;
    }
    const report = await prisma.$transaction(async (tx) => {
        const planned = await plan(parsed.document!, {
            companyId: options.companyId!, userId: options.userId, dryRun: false
        }, tx);
        if (!planned.valid || !options.userId) throw new Error('El plan de MenuItem no es válido.');
        await applyPlan(tx, planned, options.userId);
        const verification = await plan(parsed.document!, {
            companyId: options.companyId!, userId: options.userId, dryRun: false
        }, tx);
        if (!verification.valid || verification.summary.creates > 0 || verification.summary.updates > 0) {
            throw new Error('La segunda planificación no fue no-op; se revierte la transacción.');
        }
        planned.applied = true;
        return planned;
    }, { isolationLevel: 'Serializable', maxWait: 30_000, timeout: 300_000 });
    await emit(report, options.report);
}

if (require.main === module) {
    main().catch(async (error) => {
        process.stderr.write(`Error preparando platos revisados: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }).finally(async () => prisma.$disconnect());
}
