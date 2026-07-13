/**
 * Tenant-scoped remediation for terminal orders that have no items.
 *
 * Safety contract:
 *   - dry-run is the default and always writes a new JSON backup;
 *   - only PAID/DELIVERED orders without items can enter the plan;
 *   - only orders with total <= 0 and no ambiguous dependencies are eligible;
 *   - --apply requires two independent ALLOW_* environment guards, an active
 *     same-company actor and an exact company-name confirmation;
 *   - the plan is re-read under row locks before applying and any drift aborts;
 *   - payments are never deleted: non-positive ACTIVE rows are marked REVERSED;
 *   - orders are never deleted: eligible rows are marked CANCELLED;
 *   - every mutation has a tenant-scoped audit record.
 *
 * Dry-run:
 *   npm exec ts-node -- src/scripts/remediate-empty-orders.ts \
 *     --company-id 1 --out ./backups/empty-orders-dry-run.json
 *
 * Apply (only after reviewing a fresh dry-run; never point this at production
 * without the release owner's explicit authorization):
 *   ALLOW_EMPTY_ORDER_REMEDIATION=1 ALLOW_LEDGER_REMEDIATION=1 \
 *   npm exec ts-node -- src/scripts/remediate-empty-orders.ts \
 *     --company-id 1 --actor-user-id 1 --out ./backups/empty-orders-apply.json \
 *     --apply --confirm-company "Exact Company Name"
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../utils/prisma';

const TERMINAL_STATUSES = ['PAID', 'DELIVERED'] as const;
const REMEDIATION_REASON = 'DATA_REMEDIATION_EMPTY_NON_POSITIVE_ORDER';

export type RemediationOptions = {
    companyId: number;
    out: string;
    apply: boolean;
    actorUserId?: number;
    confirmCompany?: string;
};

export type OrderSnapshot = {
    id: number;
    companyId: number;
    branchId: number;
    status: string;
    salesChannel: string;
    total: number;
    invoiceNumber: string | null;
    discountCode: string | null;
    itemCount: number;
    payments: Array<{
        id: number;
        amount: number;
        status: string;
        reference: string | null;
    }>;
    externalSyncCount: number;
    cashMovementCount: number;
    inventoryMovementCount: number;
};

export type ClassifiedOrder = OrderSnapshot & {
    blockers: string[];
    eligible: boolean;
};

type PlanningClient = Pick<PrismaClient, 'order' | 'cashMovement' | 'inventoryMovement'>;

function argValue(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, name: string, required: boolean): number | undefined {
    if (value === undefined && !required) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} ${required ? 'es obligatorio y ' : ''}debe ser un entero mayor a cero.`);
    }
    return parsed;
}

export function parseArgs(argv = process.argv.slice(2)): RemediationOptions {
    if (argv.includes('--help')) {
        console.log(`
Uso:
  remediate-empty-orders --company-id <id> --out <backup.json>
  remediate-empty-orders --company-id <id> --actor-user-id <id> --out <backup.json>
      --apply --confirm-company <nombre exacto>

Por defecto sólo audita. --apply exige ALLOW_EMPTY_ORDER_REMEDIATION=1,
ALLOW_LEDGER_REMEDIATION=1, actor activo de la misma empresa y confirmación
exacta del nombre. CONFIRM_REMEDIATION_COMPANY puede sustituir
--confirm-company. El respaldo se crea antes de validar los guards de escritura.
`);
        process.exit(0);
    }

    const companyId = positiveInteger(argValue(argv, '--company-id'), '--company-id', true)!;
    const actorUserId = positiveInteger(argValue(argv, '--actor-user-id'), '--actor-user-id', false);
    const out = argValue(argv, '--out');
    if (!out) throw new Error('--out es obligatorio: indique una ruta nueva para el respaldo JSON.');

    return {
        companyId,
        actorUserId,
        out: path.resolve(out),
        apply: argv.includes('--apply'),
        confirmCompany: argValue(argv, '--confirm-company') ?? process.env.CONFIRM_REMEDIATION_COMPANY
    };
}

function isNonEmpty(value: string | null): boolean {
    return Boolean(value?.trim());
}

export function classifyOrder(snapshot: OrderSnapshot): ClassifiedOrder {
    const blockers: string[] = [];

    if (!TERMINAL_STATUSES.includes(snapshot.status as (typeof TERMINAL_STATUSES)[number])) {
        blockers.push(`estado ${snapshot.status} no es PAID/DELIVERED`);
    }
    if (snapshot.itemCount !== 0) blockers.push(`tiene ${snapshot.itemCount} item(s)`);
    if (snapshot.total > 0) blockers.push(`total positivo ${snapshot.total.toFixed(2)}`);
    if (isNonEmpty(snapshot.invoiceNumber)) blockers.push(`factura ${snapshot.invoiceNumber}`);
    if (snapshot.salesChannel !== 'RESTAURANT') blockers.push(`canal externo ${snapshot.salesChannel}`);
    if (isNonEmpty(snapshot.discountCode)) blockers.push(`promoción ${snapshot.discountCode}`);
    if (snapshot.externalSyncCount > 0) blockers.push(`${snapshot.externalSyncCount} sincronización(es) externa(s)`);
    if (snapshot.cashMovementCount > 0) blockers.push(`${snapshot.cashMovementCount} movimiento(s) de caja`);
    if (snapshot.inventoryMovementCount > 0) blockers.push(`${snapshot.inventoryMovementCount} movimiento(s) de inventario`);

    const positivePayments = snapshot.payments.filter((payment) => payment.amount > 0);
    if (positivePayments.length > 0) {
        blockers.push(`pago(s) positivo(s): ${positivePayments.map((payment) => payment.id).join(', ')}`);
    }
    const referencedPayments = snapshot.payments.filter((payment) => isNonEmpty(payment.reference));
    if (referencedPayments.length > 0) {
        blockers.push(`pago(s) con referencia externa: ${referencedPayments.map((payment) => payment.id).join(', ')}`);
    }

    return { ...snapshot, blockers, eligible: blockers.length === 0 };
}

function sortedIds(rows: Array<{ id: number }>): number[] {
    return rows.map((row) => row.id).sort((left, right) => left - right);
}

function equalIds(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function collectPlan(db: PlanningClient, companyId: number): Promise<ClassifiedOrder[]> {
    const orders = await db.order.findMany({
        where: {
            companyId,
            status: { in: [...TERMINAL_STATUSES] },
            items: { none: {} }
        },
        select: {
            id: true,
            companyId: true,
            branchId: true,
            status: true,
            salesChannel: true,
            total: true,
            invoiceNumber: true,
            discountCode: true,
            _count: { select: { items: true, pedidosYaSyncs: true } },
            payments: {
                select: { id: true, amount: true, status: true, reference: true },
                orderBy: { id: 'asc' }
            }
        },
        orderBy: { id: 'asc' }
    });

    if (orders.length === 0) return [];

    const orderReferences = orders.map((order) => `ORD-${order.id}`);
    const paymentReferences = orders.flatMap((order) =>
        order.payments.flatMap((payment) => [`PAY-${payment.id}`, `REV-PAY-${payment.id}`])
    );
    const [cashGroups, inventoryGroups] = await Promise.all([
        paymentReferences.length === 0
            ? Promise.resolve([])
            : db.cashMovement.groupBy({
                by: ['reference'],
                where: { reference: { in: paymentReferences } },
                _count: { _all: true }
            }),
        db.inventoryMovement.groupBy({
            by: ['reference'],
            where: { companyId, reference: { in: orderReferences } },
            _count: { _all: true }
        })
    ]);

    const cashCounts = new Map(cashGroups.map((group) => [group.reference, group._count._all]));
    const inventoryCounts = new Map(inventoryGroups.map((group) => [group.reference, group._count._all]));

    return orders.map((order) => {
        const cashMovementCount = order.payments.reduce(
            (sum, payment) => sum + (cashCounts.get(`PAY-${payment.id}`) ?? 0) + (cashCounts.get(`REV-PAY-${payment.id}`) ?? 0),
            0
        );
        return classifyOrder({
            id: order.id,
            companyId: order.companyId,
            branchId: order.branchId,
            status: order.status,
            salesChannel: order.salesChannel,
            total: Number(order.total),
            invoiceNumber: order.invoiceNumber,
            discountCode: order.discountCode,
            itemCount: order._count.items,
            payments: order.payments.map((payment) => ({
                id: payment.id,
                amount: Number(payment.amount),
                status: payment.status,
                reference: payment.reference
            })),
            externalSyncCount: order._count.pedidosYaSyncs,
            cashMovementCount,
            inventoryMovementCount: inventoryCounts.get(`ORD-${order.id}`) ?? 0
        });
    });
}

async function writeBackup(output: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const handle = await fs.open(output, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
        await handle.close();
    }
}

export function validateApplyGuards(options: RemediationOptions, companyName: string): number {
    if (process.env.ALLOW_EMPTY_ORDER_REMEDIATION !== '1') {
        throw new Error('Ejecución bloqueada: defina ALLOW_EMPTY_ORDER_REMEDIATION=1 después de revisar el dry-run.');
    }
    if (process.env.ALLOW_LEDGER_REMEDIATION !== '1') {
        throw new Error('Ejecución bloqueada: defina ALLOW_LEDGER_REMEDIATION=1 para autorizar el cambio del ledger.');
    }
    if (options.confirmCompany !== companyName) {
        throw new Error(`Confirmación inválida: --confirm-company debe coincidir exactamente con "${companyName}".`);
    }
    if (!options.actorUserId) {
        throw new Error('--actor-user-id es obligatorio con --apply.');
    }
    return options.actorUserId;
}

export async function runEmptyOrderRemediation(options: RemediationOptions) {
    const company = await prisma.company.findUnique({
        where: { id: options.companyId },
        select: { id: true, name: true, active: true }
    });
    if (!company) throw new Error(`No existe la empresa ${options.companyId}.`);

    const plan = await collectPlan(prisma, options.companyId);
    const eligible = plan.filter((order) => order.eligible);
    const blocked = plan.filter((order) => !order.eligible);
    const backup = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
        criteria: {
            statuses: TERMINAL_STATUSES,
            itemCount: 0,
            eligibleTotal: '<= 0',
            mutation: 'REVERSE_NON_POSITIVE_ACTIVE_PAYMENTS_AND_CANCEL_ORDER'
        },
        company,
        counts: {
            emptyTerminalOrders: plan.length,
            eligible: eligible.length,
            blocked: blocked.length,
            activePaymentsToReverse: eligible.reduce(
                (sum, order) => sum + order.payments.filter((payment) => payment.status === 'ACTIVE').length,
                0
            )
        },
        eligible,
        blocked
    };
    await writeBackup(options.out, backup);

    if (!options.apply) return { applied: false, backup: options.out, ...backup };

    const actorUserId = validateApplyGuards(options, company.name);
    const actor = await prisma.user.findFirst({
        where: { id: actorUserId, companyId: options.companyId, status: 'ACTIVE' },
        select: { id: true }
    });
    if (!actor) throw new Error('El actor no existe, está inactivo o pertenece a otra empresa.');
    if (eligible.length === 0) return { applied: false, reason: 'NO_ELIGIBLE_ORDERS', backup: options.out, ...backup };

    const plannedIds = sortedIds(eligible);
    const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
            Prisma.sql`SELECT id FROM \`Order\` WHERE companyId = ${options.companyId} AND id IN (${Prisma.join(plannedIds)}) FOR UPDATE`
        );

        const lockedPlan = await collectPlan(tx, options.companyId);
        const lockedEligible = lockedPlan.filter((order) => order.eligible);
        const lockedIds = sortedIds(lockedEligible);
        if (!equalIds(plannedIds, lockedIds)) {
            throw new Error(
                `El plan cambió después del respaldo (esperado: ${plannedIds.join(', ') || 'ninguno'}; ` +
                `actual: ${lockedIds.join(', ') || 'ninguno'}). No se aplicó ningún cambio.`
            );
        }

        let reversedPayments = 0;
        for (const order of lockedEligible) {
            const activePayments = order.payments.filter((payment) => payment.status === 'ACTIVE');
            if (activePayments.some((payment) => payment.amount > 0)) {
                throw new Error(`Guard interno: la orden ${order.id} adquirió un pago positivo.`);
            }

            for (const payment of activePayments) {
                const updated = await tx.payment.updateMany({
                    where: {
                        id: payment.id,
                        orderId: order.id,
                        status: 'ACTIVE',
                        amount: { lte: 0 },
                        order: { companyId: options.companyId }
                    },
                    data: {
                        status: 'REVERSED',
                        reversedAt: new Date(),
                        reversedById: actorUserId,
                        reversalReason: REMEDIATION_REASON
                    }
                });
                if (updated.count !== 1) throw new Error(`No se pudo bloquear/revertir el pago ${payment.id}.`);
                reversedPayments += 1;
                await tx.auditLog.create({
                    data: {
                        companyId: options.companyId,
                        entityType: 'Payment',
                        entityId: payment.id,
                        action: 'DATA_REMEDIATION_REVERSE',
                        userId: actorUserId,
                        details: { orderId: order.id, amount: payment.amount, reason: REMEDIATION_REASON }
                    }
                });
            }

            const cancelled = await tx.order.updateMany({
                where: {
                    id: order.id,
                    companyId: options.companyId,
                    status: { in: [...TERMINAL_STATUSES] },
                    total: { lte: 0 },
                    items: { none: {} },
                    invoiceNumber: null,
                    pedidosYaSyncs: { none: {} }
                },
                data: {
                    status: 'CANCELLED',
                    cancelledById: actorUserId,
                    cancelReason: REMEDIATION_REASON,
                    cancelledAt: new Date()
                }
            });
            if (cancelled.count !== 1) throw new Error(`No se pudo cancelar de forma segura la orden ${order.id}.`);
            await tx.auditLog.create({
                data: {
                    companyId: options.companyId,
                    entityType: 'Order',
                    entityId: order.id,
                    action: 'DATA_REMEDIATION_CANCEL',
                    userId: actorUserId,
                    details: {
                        previousStatus: order.status,
                        total: order.total,
                        reversedPaymentIds: activePayments.map((payment) => payment.id),
                        reason: REMEDIATION_REASON
                    }
                }
            });
        }

        return { cancelledOrders: lockedEligible.length, reversedPayments };
    }, { maxWait: 10_000, timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { applied: true, backup: options.out, ...result };
}

async function main(): Promise<void> {
    const options = parseArgs();
    const result = await runEmptyOrderRemediation(options);
    console.log(JSON.stringify(result, null, 2));
    if (!options.apply && 'blocked' in result && result.blocked.length > 0) process.exitCode = 2;
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
