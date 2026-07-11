/**
 * Clears seeded weighted-average costs for products created from recipe catalog
 * maps when there is no operational evidence (stock, movement, purchase, cost
 * history or production). Product.cost remains the reviewed reference value.
 *
 * Dry-run is the default. Apply is tenant-scoped and all-or-nothing.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

const DEFAULT_MAPS = [
    '../../prisma/data/recetas-menu.catalog-map.json',
    '../../prisma/data/recetas-menu.review-production-catalog-map.json',
    '../../prisma/data/recetas-menu.review-beverage-catalog-map.json',
    '../../prisma/data/recetas-menu.review-dessert-catalog-map.json'
].map((file) => path.resolve(__dirname, file));

type CliOptions = {
    companyId: number;
    userId?: number;
    reportFile?: string;
    apply: boolean;
};

type ReferenceEntry = {
    productSku: string;
    catalogName: string;
    referenceCost: number;
    mapFile: string;
};

type PlannedEntry = ReferenceEntry & {
    productId?: number;
    currentReferenceCost?: number;
    currentAverageCost?: number;
    totalStock?: number;
    evidence?: {
        inventoryMovements: number;
        costHistory: number;
        purchaseOrderItems: number;
        productionOrders: number;
    };
    action: 'RESET_AVERAGE' | 'UNCHANGED' | 'BLOCKED';
    reason: string;
};

function flagValue(args: string[], name: string): string | undefined {
    const equal = args.find((arg) => arg.startsWith(`${name}=`));
    if (equal) return equal.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function positiveId(raw: string | undefined, flag: string, required: boolean): number | undefined {
    if (!raw && !required) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} debe ser un entero mayor a cero.`);
    return parsed;
}

function parseArgs(args = process.argv.slice(2)): CliOptions {
    if (args.includes('--help')) {
        process.stdout.write(
            'Uso: normalize-reference-only-averages --company-id <id> [--report <json>] [--apply --user-id <id>]\n'
        );
        process.exit(0);
    }
    const apply = args.includes('--apply');
    return {
        companyId: positiveId(flagValue(args, '--company-id'), '--company-id', true)!,
        userId: positiveId(flagValue(args, '--user-id'), '--user-id', apply),
        reportFile: flagValue(args, '--report') ? path.resolve(flagValue(args, '--report')!) : undefined,
        apply
    };
}

async function loadEntries(): Promise<ReferenceEntry[]> {
    const bySku = new Map<string, ReferenceEntry>();
    for (const mapFile of DEFAULT_MAPS) {
        const raw = JSON.parse(await readFile(mapFile, 'utf8')) as {
            entries?: Array<{
                productSku?: unknown;
                catalogName?: unknown;
                mode?: unknown;
                referenceCost?: unknown;
            }>;
        };
        if (!Array.isArray(raw.entries)) throw new Error(`Mapa inválido: ${mapFile}.`);
        for (const entry of raw.entries) {
            if (entry.mode !== 'CREATE' || typeof entry.referenceCost !== 'number' || entry.referenceCost <= 0) continue;
            if (typeof entry.productSku !== 'string' || typeof entry.catalogName !== 'string') {
                throw new Error(`Entrada CREATE inválida en ${mapFile}.`);
            }
            const prior = bySku.get(entry.productSku);
            if (prior && Math.abs(prior.referenceCost - entry.referenceCost) > 0.000001) {
                throw new Error(`Costo referencial conflictivo para ${entry.productSku}.`);
            }
            bySku.set(entry.productSku, {
                productSku: entry.productSku,
                catalogName: entry.catalogName,
                referenceCost: entry.referenceCost,
                mapFile: path.basename(mapFile)
            });
        }
    }
    return [...bySku.values()].sort((a, b) => a.productSku.localeCompare(b.productSku));
}

async function buildPlan(
    db: Prisma.TransactionClient | typeof prisma,
    companyId: number,
    entries: ReferenceEntry[]
): Promise<PlannedEntry[]> {
    const products = await db.product.findMany({
        where: { companyId, sku: { in: entries.map((entry) => entry.productSku) } },
        select: {
            id: true,
            sku: true,
            cost: true,
            currentAverageCost: true,
            stocks: { select: { quantity: true } },
            _count: {
                select: {
                    inventoryMovements: true,
                    costHistory: true,
                    purchaseOrderItems: true,
                    productionOrders: true
                }
            }
        }
    });
    const bySku = new Map(products.filter((product) => product.sku).map((product) => [product.sku!, product]));

    return entries.map((entry) => {
        const product = bySku.get(entry.productSku);
        if (!product) return { ...entry, action: 'BLOCKED', reason: 'El producto administrado no existe.' };
        const currentReferenceCost = Number(product.cost);
        const currentAverageCost = Number(product.currentAverageCost);
        const totalStock = product.stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);
        const evidence = {
            inventoryMovements: product._count.inventoryMovements,
            costHistory: product._count.costHistory,
            purchaseOrderItems: product._count.purchaseOrderItems,
            productionOrders: product._count.productionOrders
        };
        const base = {
            ...entry,
            productId: product.id,
            currentReferenceCost,
            currentAverageCost,
            totalStock,
            evidence
        };
        if (Math.abs(currentReferenceCost - Number(entry.referenceCost.toFixed(2))) > 0.011) {
            return { ...base, action: 'BLOCKED' as const, reason: 'Product.cost ya no coincide con el costo referencial administrado.' };
        }
        if (currentAverageCost <= 0.000001) {
            return { ...base, action: 'UNCHANGED' as const, reason: 'El promedio ya está vacío; el costo de referencia permanece disponible.' };
        }
        if (Math.abs(currentAverageCost - entry.referenceCost) > 0.011) {
            return { ...base, action: 'BLOCKED' as const, reason: 'El promedio difiere del valor sembrado; podría ser un costo operativo real.' };
        }
        if (Math.abs(totalStock) > 0.000001 || Object.values(evidence).some((count) => count > 0)) {
            return { ...base, action: 'BLOCKED' as const, reason: 'Existe evidencia operativa; el promedio no puede limpiarse automáticamente.' };
        }
        return {
            ...base,
            action: 'RESET_AVERAGE' as const,
            reason: 'Promedio sembrado sin evidencia operativa; se conserva Product.cost como referencia.'
        };
    });
}

async function main(): Promise<void> {
    const options = parseArgs();
    const entries = await loadEntries();
    const company = await prisma.company.findFirst({
        where: { id: options.companyId, active: true },
        select: { id: true, name: true }
    });
    if (!company) throw new Error(`No existe una empresa activa con id ${options.companyId}.`);

    let plan = await buildPlan(prisma, options.companyId, entries);
    if (options.apply) {
        const user = await prisma.user.findFirst({
            where: { id: options.userId!, companyId: options.companyId, status: 'ACTIVE' },
            select: { id: true }
        });
        if (!user) throw new Error(`El usuario ${options.userId} no está activo en la empresa.`);

        plan = await prisma.$transaction(async (tx) => {
            const locked = await buildPlan(tx, options.companyId, entries);
            const blocked = locked.filter((entry) => entry.action === 'BLOCKED');
            if (blocked.length) {
                throw new Error(`Plan bloqueado: ${blocked.map((entry) => `${entry.productSku}: ${entry.reason}`).join('; ')}`);
            }
            const resets = locked.filter((entry) => entry.action === 'RESET_AVERAGE');
            for (const entry of resets) {
                await tx.product.update({
                    where: { id: entry.productId! },
                    data: { currentAverageCost: 0 }
                });
            }
            if (resets.length) {
                await tx.auditLog.createMany({
                    data: resets.map((entry) => ({
                        companyId: options.companyId,
                        userId: options.userId!,
                        entityType: 'Product',
                        entityId: entry.productId!,
                        action: 'UPDATE' as const,
                        details: {
                            field: 'currentAverageCost',
                            from: entry.currentAverageCost,
                            to: 0,
                            preservedReferenceCost: entry.currentReferenceCost,
                            reason: 'normalize-reference-only-averages'
                        }
                    }))
                });
            }
            return locked;
        }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 });
    }

    const report = {
        applied: options.apply,
        company,
        maps: DEFAULT_MAPS.map((file) => path.basename(file)),
        summary: {
            entries: plan.length,
            resets: plan.filter((entry) => entry.action === 'RESET_AVERAGE').length,
            unchanged: plan.filter((entry) => entry.action === 'UNCHANGED').length,
            blocked: plan.filter((entry) => entry.action === 'BLOCKED').length
        },
        entries: plan
    };
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(rendered);
    if (options.reportFile) await writeFile(options.reportFile, rendered, 'utf8');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(async () => prisma.$disconnect());
}

export { buildPlan, loadEntries };
