/**
 * Tenant-scoped normalization for legacy products whose reference cost is zero.
 *
 * Safety contract:
 *   - dry-run is the default and never mutates the database;
 *   - only Product.cost = 0 enters the plan;
 *   - Product.currentAverageCost, lastPurchaseCost, stock and cost history are
 *     never changed;
 *   - --apply requires an explicit environment guard, an active same-company
 *     ADMIN/SUPERADMIN actor and the exact company name;
 *   - the plan is re-read under row locks and any drift aborts the transaction;
 *   - every changed product receives an AuditLog row in the same transaction;
 *   - a second execution is a no-op.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../utils/prisma';

const NORMALIZED_REFERENCE_COST = new Prisma.Decimal(1);
const NORMALIZATION_REASON = 'NORMALIZE_ZERO_REFERENCE_COST_TO_ONE';

export type NormalizeZeroCostOptions = {
    companyId: number;
    reportFile: string;
    apply: boolean;
    actorUserId?: number;
    confirmCompany?: string;
};

export type ZeroCostPlanEntry = {
    id: number;
    companyId: number;
    name: string;
    sku: string | null;
    type: string;
    active: boolean;
    referenceCostBefore: string;
    referenceCostKnownBefore: boolean;
    currentAverageCostPreserved: string;
    averageCostKnownPreserved: boolean;
    lastPurchaseCostPreserved: string;
    lastPurchaseCostKnownPreserved: boolean;
    updatedAt: string;
};

type PlanningClient = Pick<PrismaClient, 'product'> | Pick<Prisma.TransactionClient, 'product'>;

function argValue(argv: string[], name: string): string | undefined {
    const inline = argv.find((value) => value.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(raw: string | undefined, flag: string, required: boolean): number | undefined {
    if (raw === undefined && !required) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${flag} ${required ? 'es obligatorio y ' : ''}debe ser un entero mayor a cero.`);
    }
    return value;
}

export function parseArgs(argv = process.argv.slice(2)): NormalizeZeroCostOptions {
    const knownFlags = new Set([
        '--company-id',
        '--report',
        '--apply',
        '--dry-run',
        '--actor-user-id',
        '--confirm-company',
        '--help',
    ]);
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        const flag = token.split('=')[0];
        if (!flag.startsWith('--')) continue;
        if (!knownFlags.has(flag)) throw new Error(`Opción desconocida: ${flag}.`);
        if (!token.includes('=') && !['--apply', '--dry-run', '--help'].includes(flag)) index += 1;
    }
    if (argv.includes('--apply') && argv.includes('--dry-run')) {
        throw new Error('--apply y --dry-run son mutuamente excluyentes.');
    }
    if (argv.includes('--help')) {
        process.stdout.write(`
Uso:
  normalize-zero-reference-costs --company-id <id> --report <archivo.json>
  normalize-zero-reference-costs --company-id <id> --report <archivo.json>
      --apply --actor-user-id <id> --confirm-company <nombre exacto>

El modo predeterminado es dry-run. --apply exige
ALLOW_ZERO_REFERENCE_COST_NORMALIZATION=1, un actor ADMIN/SUPERADMIN activo de
la misma empresa y la confirmación exacta del nombre. Sólo cambia Product.cost
de 0 a 1 y referenceCostKnown a true; conserva costos transaccionales, stock e
historial.
`);
        process.exit(0);
    }

    const report = argValue(argv, '--report');
    if (!report) throw new Error('--report es obligatorio y debe apuntar a un archivo JSON nuevo.');
    const apply = argv.includes('--apply');
    return {
        companyId: positiveInteger(argValue(argv, '--company-id'), '--company-id', true)!,
        reportFile: path.resolve(report),
        apply,
        actorUserId: positiveInteger(argValue(argv, '--actor-user-id'), '--actor-user-id', apply),
        confirmCompany: argValue(argv, '--confirm-company') ?? process.env.CONFIRM_ZERO_COST_COMPANY,
    };
}

function decimalString(value: Prisma.Decimal): string {
    return value.toFixed();
}

export async function collectZeroCostPlan(
    db: PlanningClient,
    companyId: number,
): Promise<ZeroCostPlanEntry[]> {
    const products = await db.product.findMany({
        where: { companyId, cost: 0 },
        select: {
            id: true,
            companyId: true,
            name: true,
            sku: true,
            type: true,
            active: true,
            cost: true,
            referenceCostKnown: true,
            currentAverageCost: true,
            averageCostKnown: true,
            lastPurchaseCost: true,
            lastPurchaseCostKnown: true,
            updatedAt: true,
        },
        orderBy: { id: 'asc' },
    });

    return products.map((product) => ({
        id: product.id,
        companyId: product.companyId,
        name: product.name,
        sku: product.sku,
        type: product.type,
        active: product.active,
        referenceCostBefore: decimalString(product.cost),
        referenceCostKnownBefore: product.referenceCostKnown,
        currentAverageCostPreserved: decimalString(product.currentAverageCost),
        averageCostKnownPreserved: product.averageCostKnown,
        lastPurchaseCostPreserved: decimalString(product.lastPurchaseCost),
        lastPurchaseCostKnownPreserved: product.lastPurchaseCostKnown,
        updatedAt: product.updatedAt.toISOString(),
    }));
}

function stablePlan(entry: ZeroCostPlanEntry): string {
    return JSON.stringify(entry);
}

function samePlan(left: ZeroCostPlanEntry[], right: ZeroCostPlanEntry[]): boolean {
    return left.length === right.length
        && left.every((entry, index) => stablePlan(entry) === stablePlan(right[index]));
}

async function writeReportExclusive(reportFile: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(reportFile), { recursive: true });
    const handle = await fs.open(reportFile, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
        await handle.close();
    }
}

async function replaceReservedReport(reportFile: string, payload: unknown): Promise<void> {
    await fs.writeFile(reportFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function validateApplyGuards(
    options: NormalizeZeroCostOptions,
    companyName: string,
): number {
    if (process.env.ALLOW_ZERO_REFERENCE_COST_NORMALIZATION !== '1') {
        throw new Error(
            'Ejecución bloqueada: defina ALLOW_ZERO_REFERENCE_COST_NORMALIZATION=1 después de revisar el dry-run.',
        );
    }
    if (options.confirmCompany !== companyName) {
        throw new Error(`Confirmación inválida: --confirm-company debe coincidir exactamente con "${companyName}".`);
    }
    if (!options.actorUserId) throw new Error('--actor-user-id es obligatorio con --apply.');
    return options.actorUserId;
}

export async function runZeroCostNormalization(options: NormalizeZeroCostOptions) {
    const company = await prisma.company.findUnique({
        where: { id: options.companyId },
        select: { id: true, name: true, active: true },
    });
    if (!company) throw new Error(`No existe la empresa ${options.companyId}.`);

    const plan = await collectZeroCostPlan(prisma, options.companyId);
    const validApplyActors = await prisma.user.findMany({
        where: {
            companyId: options.companyId,
            status: 'ACTIVE',
            role: { name: { in: ['ADMIN', 'SUPERADMIN'] } },
        },
        select: { id: true, username: true, role: { select: { name: true } } },
        orderBy: { id: 'asc' },
    });
    const baseReport = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
        company,
        rule: {
            predicate: 'Product.companyId = company.id AND Product.cost = 0',
            mutation: 'Product.cost = 1; Product.referenceCostKnown = true',
            preserved: [
                'Product.currentAverageCost',
                'Product.averageCostKnown',
                'Product.lastPurchaseCost',
                'Product.lastPurchaseCostKnown',
                'Stock',
                'InventoryMovement',
                'InventoryBatch',
                'ProductCostHistory',
            ],
        },
        validApplyActors,
        plannedCount: plan.length,
        products: plan,
    };

    if (!options.apply) {
        await writeReportExclusive(options.reportFile, { applied: false, ...baseReport });
        return { applied: false, report: options.reportFile, ...baseReport };
    }

    const actorUserId = validateApplyGuards(options, company.name);
    const actor = validApplyActors.find((candidate) => candidate.id === actorUserId);
    if (!actor) {
        throw new Error('El actor debe ser ADMIN/SUPERADMIN activo y pertenecer a la empresa indicada.');
    }
    await writeReportExclusive(options.reportFile, {
        applied: false,
        status: 'PENDING_APPLY',
        ...baseReport,
        actor,
    });

    let result;
    try {
        result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`SELECT id FROM \`Product\`
                    WHERE companyId = ${options.companyId} AND cost = 0
                    ORDER BY id FOR UPDATE`,
            );
            const lockedPlan = await collectZeroCostPlan(tx, options.companyId);
            if (!samePlan(plan, lockedPlan)) {
                throw new Error('El plan cambió después del dry-run interno; no se aplicó ningún cambio.');
            }

            let updated = 0;
            for (const product of lockedPlan) {
                const change = await tx.product.updateMany({
                    where: { id: product.id, companyId: options.companyId, cost: 0 },
                    data: { cost: NORMALIZED_REFERENCE_COST, referenceCostKnown: true },
                });
                if (change.count !== 1) {
                    throw new Error(`No se pudo normalizar de forma exclusiva el producto ${product.id}.`);
                }
                updated += change.count;
            }

            const audits = lockedPlan.length === 0
                ? { count: 0 }
                : await tx.auditLog.createMany({
                    data: lockedPlan.map((product) => ({
                        companyId: options.companyId,
                        entityType: 'Product',
                        entityId: product.id,
                        action: 'UPDATE',
                        userId: actor.id,
                        details: {
                            reason: NORMALIZATION_REASON,
                            referenceCost: {
                                from: product.referenceCostBefore,
                                to: NORMALIZED_REFERENCE_COST.toFixed(),
                            },
                            referenceCostKnown: {
                                from: product.referenceCostKnownBefore,
                                to: true,
                            },
                            currentAverageCostPreserved: product.currentAverageCostPreserved,
                            averageCostKnownPreserved: product.averageCostKnownPreserved,
                            lastPurchaseCostPreserved: product.lastPurchaseCostPreserved,
                            lastPurchaseCostKnownPreserved: product.lastPurchaseCostKnownPreserved,
                            createsPurchase: false,
                            createsStock: false,
                            createsInventoryMovement: false,
                            createsCostHistory: false,
                        } as Prisma.InputJsonValue,
                    })),
                });
            if (audits.count !== lockedPlan.length) {
                throw new Error(`Auditoría incompleta: ${audits.count}/${lockedPlan.length}.`);
            }

            const changedProducts = lockedPlan.length === 0
                ? []
                : await tx.product.findMany({
                    where: { companyId: options.companyId, id: { in: lockedPlan.map((product) => product.id) } },
                    select: {
                        id: true,
                        cost: true,
                        referenceCostKnown: true,
                        currentAverageCost: true,
                        averageCostKnown: true,
                        lastPurchaseCost: true,
                        lastPurchaseCostKnown: true,
                    },
                    orderBy: { id: 'asc' },
                });
            if (changedProducts.length !== lockedPlan.length) {
                throw new Error('La verificación posterior no encontró todos los productos normalizados.');
            }
            for (let index = 0; index < changedProducts.length; index += 1) {
                const before = lockedPlan[index];
                const after = changedProducts[index];
                if (
                    after.id !== before.id
                    || !after.cost.equals(NORMALIZED_REFERENCE_COST)
                    || after.referenceCostKnown !== true
                    || decimalString(after.currentAverageCost) !== before.currentAverageCostPreserved
                    || after.averageCostKnown !== before.averageCostKnownPreserved
                    || decimalString(after.lastPurchaseCost) !== before.lastPurchaseCostPreserved
                    || after.lastPurchaseCostKnown !== before.lastPurchaseCostKnownPreserved
                ) {
                    throw new Error(`La conciliación posterior falló para Product ${before.id}.`);
                }
            }

            const remainingZero = await tx.product.count({
                where: { companyId: options.companyId, cost: 0 },
            });
            if (remainingZero !== 0) {
                throw new Error(`Quedaron ${remainingZero} productos con costo de referencia cero.`);
            }
            return { updated, auditRows: audits.count, remainingZero };
        }, {
            maxWait: 10_000,
            timeout: 60_000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
    } catch (error) {
        await replaceReservedReport(options.reportFile, {
            applied: false,
            status: 'ROLLED_BACK_OR_NOT_STARTED',
            ...baseReport,
            actor,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    const secondPass = await collectZeroCostPlan(prisma, options.companyId);
    if (secondPass.length !== 0) {
        throw new Error(`La verificación idempotente encontró ${secondPass.length} productos pendientes.`);
    }

    const finalReport = {
        applied: true,
        status: 'APPLIED_AND_VERIFIED',
        ...baseReport,
        actor,
        result,
        idempotency: { secondPassPlannedCount: secondPass.length },
    };
    await replaceReservedReport(options.reportFile, finalReport);
    return { report: options.reportFile, ...finalReport };
}

async function main(): Promise<void> {
    const options = parseArgs();
    const result = await runZeroCostNormalization(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
    main()
        .catch((error) => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
