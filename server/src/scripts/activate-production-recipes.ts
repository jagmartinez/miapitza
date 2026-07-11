/**
 * Applies the reviewed ACTIVE/DRAFT decision for the recipes imported from
 * Recetas Menu.xlsx. Dry-run is the default and every apply is tenant-scoped,
 * cycle-checked and committed in one transaction.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

type TargetStatus = 'ACTIVE' | 'DRAFT';

type ActivationDecision = {
    productSku: string;
    recipeName: string;
    targetStatus: TargetStatus;
    reason: string;
};

type ActivationMap = {
    schemaVersion: number;
    decisions: ActivationDecision[];
};

type CliOptions = {
    companyId: number;
    userId?: number;
    mapFile: string;
    reportFile?: string;
    apply: boolean;
};

const DEFAULT_MAP = path.resolve(__dirname, '../../prisma/data/recetas-menu.production-activation.json');

function flagValue(args: string[], name: string): string | undefined {
    const equal = args.find((arg) => arg.startsWith(`${name}=`));
    if (equal) return equal.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function positiveId(raw: string | undefined, flag: string, required: boolean): number | undefined {
    if (!raw && !required) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} debe ser un entero mayor a cero.`);
    return value;
}

function parseArgs(args = process.argv.slice(2)): CliOptions {
    if (args.includes('--help')) {
        process.stdout.write(
            'Uso: activate-production-recipes --company-id <id> [--map <json>] [--report <json>] [--apply --user-id <id>]\n'
        );
        process.exit(0);
    }
    const apply = args.includes('--apply');
    return {
        companyId: positiveId(flagValue(args, '--company-id'), '--company-id', true)!,
        userId: positiveId(flagValue(args, '--user-id'), '--user-id', apply),
        mapFile: path.resolve(flagValue(args, '--map') || DEFAULT_MAP),
        reportFile: flagValue(args, '--report') ? path.resolve(flagValue(args, '--report')!) : undefined,
        apply
    };
}

function parseMap(raw: string): ActivationMap {
    const value = JSON.parse(raw) as Partial<ActivationMap>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.decisions) || value.decisions.length === 0) {
        throw new Error('El mapa de activación no cumple el esquema esperado.');
    }
    const seen = new Set<string>();
    for (const decision of value.decisions) {
        if (!decision || typeof decision.productSku !== 'string' || !decision.productSku.trim()) {
            throw new Error('Cada decisión debe declarar productSku.');
        }
        if (!['ACTIVE', 'DRAFT'].includes(decision.targetStatus)) {
            throw new Error(`Estado no permitido para ${decision.productSku}.`);
        }
        if (seen.has(decision.productSku)) throw new Error(`SKU duplicado en el mapa: ${decision.productSku}.`);
        seen.add(decision.productSku);
    }
    return value as ActivationMap;
}

type PlannedRecipe = {
    id: number;
    productId: number;
    productSku: string;
    productName: string;
    version: number;
    currentStatus: string;
    targetStatus: TargetStatus;
    action: 'UPDATE' | 'UNCHANGED';
    reason: string;
    componentProductIds: number[];
};

async function buildPlan(
    db: Prisma.TransactionClient | typeof prisma,
    companyId: number,
    map: ActivationMap
): Promise<PlannedRecipe[]> {
    const products = await db.product.findMany({
        where: { companyId, sku: { in: map.decisions.map((entry) => entry.productSku) } },
        select: { id: true, sku: true, name: true }
    });
    const productBySku = new Map(products.map((product) => [product.sku, product]));
    const missingProducts = map.decisions.filter((entry) => !productBySku.has(entry.productSku));
    if (missingProducts.length) {
        throw new Error(`Productos de salida ausentes: ${missingProducts.map((entry) => entry.productSku).join(', ')}.`);
    }

    const recipes = await db.productionRecipe.findMany({
        where: { companyId, productId: { in: products.map((product) => product.id) } },
        include: { components: { select: { componentProductId: true } } },
        orderBy: [{ productId: 'asc' }, { version: 'desc' }]
    });

    const latestByProduct = new Map<number, typeof recipes[number]>();
    for (const recipe of recipes) {
        if (!latestByProduct.has(recipe.productId)) latestByProduct.set(recipe.productId, recipe);
    }

    const plan = map.decisions.map((decision) => {
        const product = productBySku.get(decision.productSku)!;
        const recipe = latestByProduct.get(product.id);
        if (!recipe) throw new Error(`No existe receta para ${decision.productSku} (${product.name}).`);
        if (recipe.components.length === 0) throw new Error(`La receta ${decision.productSku} no tiene componentes.`);
        return {
            id: recipe.id,
            productId: recipe.productId,
            productSku: decision.productSku,
            productName: product.name,
            version: recipe.version,
            currentStatus: recipe.status,
            targetStatus: decision.targetStatus,
            action: recipe.status === decision.targetStatus ? 'UNCHANGED' as const : 'UPDATE' as const,
            reason: decision.reason,
            componentProductIds: recipe.components.map((component) => component.componentProductId)
        };
    });

    await assertFutureGraphHasNoCycles(db, companyId, plan);
    return plan;
}

async function assertFutureGraphHasNoCycles(
    db: Prisma.TransactionClient | typeof prisma,
    companyId: number,
    plan: PlannedRecipe[]
): Promise<void> {
    const selectedProductIds = new Set(plan.map((entry) => entry.productId));
    const existing = await db.productionRecipe.findMany({
        where: { companyId, status: 'ACTIVE', productId: { notIn: [...selectedProductIds] } },
        include: { components: { select: { componentProductId: true } } }
    });
    const adjacency = new Map<number, number[]>();
    for (const recipe of existing) {
        if (adjacency.has(recipe.productId)) {
            throw new Error(`Hay más de una receta activa para el producto ${recipe.productId}.`);
        }
        adjacency.set(recipe.productId, recipe.components.map((component) => component.componentProductId));
    }
    for (const recipe of plan.filter((entry) => entry.targetStatus === 'ACTIVE')) {
        adjacency.set(recipe.productId, recipe.componentProductIds);
    }

    const visiting = new Set<number>();
    const visited = new Set<number>();
    const visit = (productId: number, trail: number[]): void => {
        if (visiting.has(productId)) {
            throw new Error(`Dependencia circular detectada: ${[...trail, productId].join(' -> ')}.`);
        }
        if (visited.has(productId)) return;
        visiting.add(productId);
        for (const componentId of adjacency.get(productId) || []) visit(componentId, [...trail, productId]);
        visiting.delete(productId);
        visited.add(productId);
    };
    for (const productId of adjacency.keys()) visit(productId, []);
}

async function main(): Promise<void> {
    const options = parseArgs();
    const map = parseMap(await readFile(options.mapFile, 'utf8'));
    const company = await prisma.company.findFirst({
        where: { id: options.companyId, active: true },
        select: { id: true, name: true }
    });
    if (!company) throw new Error(`No existe una empresa activa con id ${options.companyId}.`);

    let plan = await buildPlan(prisma, options.companyId, map);
    if (options.apply) {
        const actor = await prisma.user.findFirst({
            where: { id: options.userId!, companyId: options.companyId, status: 'ACTIVE' },
            select: { id: true }
        });
        if (!actor) throw new Error(`El usuario ${options.userId} no está activo en la empresa ${options.companyId}.`);

        plan = await prisma.$transaction(async (tx) => {
            const lockedPlan = await buildPlan(tx, options.companyId, map);
            for (const recipe of lockedPlan.filter((entry) => entry.action === 'UPDATE')) {
                if (recipe.targetStatus === 'ACTIVE') {
                    await tx.productionRecipe.updateMany({
                        where: {
                            companyId: options.companyId,
                            productId: recipe.productId,
                            status: 'ACTIVE',
                            id: { not: recipe.id }
                        },
                        data: { status: 'INACTIVE' }
                    });
                }
                await tx.productionRecipe.update({ where: { id: recipe.id }, data: { status: recipe.targetStatus } });
            }
            const changed = lockedPlan.filter((entry) => entry.action === 'UPDATE');
            if (changed.length) {
                await tx.auditLog.createMany({
                    data: changed.map((entry) => ({
                        companyId: options.companyId,
                        userId: options.userId!,
                        entityType: 'ProductionRecipe',
                        entityId: entry.id,
                        action: 'UPDATE' as const,
                        details: { status: entry.targetStatus, source: 'recetas-menu.production-activation.json' }
                    }))
                });
            }
            return lockedPlan;
        }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 });
    }

    const report = {
        applied: options.apply,
        company,
        mapFile: options.mapFile,
        summary: {
            total: plan.length,
            activeTarget: plan.filter((entry) => entry.targetStatus === 'ACTIVE').length,
            draftTarget: plan.filter((entry) => entry.targetStatus === 'DRAFT').length,
            updates: plan.filter((entry) => entry.action === 'UPDATE').length,
            unchanged: plan.filter((entry) => entry.action === 'UNCHANGED').length
        },
        recipes: plan.map(({ componentProductIds, ...entry }) => ({ ...entry, components: componentProductIds.length }))
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(output);
    if (options.reportFile) await writeFile(options.reportFile, output, 'utf8');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(async () => prisma.$disconnect());
}

export { buildPlan, parseMap };
