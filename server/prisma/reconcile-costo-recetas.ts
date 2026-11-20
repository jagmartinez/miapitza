/**
 * Applies a reviewed recipe-costing plan (prisma/data/costo-recetas-*.json, phases A / A2).
 *
 * Dry-run by default. To write:
 *   ALLOW_RECIPE_COST_RECONCILIATION=1 npx ts-node --transpile-only prisma/reconcile-costo-recetas.ts <plan.json> --apply
 *
 * Guards (see impact review): no open orders / production orders / pending POs,
 * every row matches its expected old value, factors only change on products
 * without inventory history, averages and last purchase costs are never touched.
 * Optional `newProducts` are created by sku (idempotent: an existing sku must match).
 * With --apply every check is re-evaluated inside the single transaction before
 * writing; a second run must report 0 changes.
 */
import fs from 'fs';
import { Prisma, StorageType, ProductType } from '@prisma/client';
import prisma from '../src/utils/prisma';

type Db = Prisma.TransactionClient | typeof prisma;
type CostRow = { productId: number; sku: string | null; name: string; oldCost: number; newCost: number };
type UnitRow = { productUnitId: number; productId: number; sku: string; oldFactor: number; newFactor: number };
type LineRow = {
    recipeId: number;
    old: { productId: number; quantity: number; unit: string; unitId: number };
    new: { productId: number; quantity: number; unit: string; unitId: number };
};
type NewProduct = {
    sku: string; name: string; type: ProductType; baseUnit: string; categoryId: number; categoryName: string;
    storageType?: StorageType; cost: number;
};
type Plan = {
    companyId: number; phase: string; productCosts?: CostRow[]; productUnits?: UnitRow[]; recipeLines?: LineRow[]; newProducts?: NewProduct[];
};

const EPS = 5e-7;
const same = (a: unknown, b: number, eps = EPS) => Math.abs(Number(a) - b) < eps;
// Production ran normalize-zero-reference-costs (0 → placeholder 1). A plan built
// from a pre-normalization snapshot expects 0; treat the exact placeholder as 0.
const matchesOldCost = (current: unknown, expected: number) =>
    same(current, expected, 0.005) || (expected === 0 && same(current, 1, 1e-9));

async function analyze(db: Db, plan: Plan) {
    const companyId = plan.companyId;
    const [openOrders, openProduction, pendingPOs] = await Promise.all([
        db.order.count({ where: { status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } } }),
        db.productionOrder.count({ where: { status: { in: ['DRAFT', 'PENDING', 'IN_PROGRESS'] } } }),
        db.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } } }),
    ]);
    const blockers: string[] = [];
    // --allow-open-orders: explicit business decision (the open orders are tests); every other guard still applies.
    if (openOrders && !process.argv.includes("--allow-open-orders")) blockers.push(`${openOrders} órdenes abiertas`);
    else if (openOrders) console.error(`AVISO: ${openOrders} órdenes abiertas ignoradas por --allow-open-orders`);
    if (openProduction) blockers.push(`${openProduction} órdenes de producción abiertas`);
    if (pendingPOs) blockers.push(`${pendingPOs} OC pendientes de recibir`);

    const productCreates: (NewProduct & { baseUnitId: number })[] = [];
    let productNoop = 0;
    for (const row of plan.newProducts ?? []) {
        const label = `producto nuevo ${row.sku}`;
        if (!(row.cost > 0) || row.cost >= 10000) { blockers.push(`${label}: costo fuera de rango ${row.cost}`); continue; }
        const unit = await db.unitOfMeasure.findFirst({ where: { companyId, abbreviation: row.baseUnit, active: true } });
        if (!unit) { blockers.push(`${label}: unidad base ${row.baseUnit} inexistente o inactiva`); continue; }
        const category = await db.category.findFirst({ where: { id: row.categoryId, companyId, active: true } });
        if (!category || category.name !== row.categoryName) { blockers.push(`${label}: categoría ${row.categoryId} ≠ ${row.categoryName}`); continue; }
        const existing = await db.product.findFirst({
            where: { companyId, sku: row.sku },
            select: { name: true, type: true, active: true, baseUnitId: true, unit: true, cost: true, referenceCostKnown: true, allowedUnits: { where: { active: true, isDefault: true } } },
        });
        if (existing) {
            const ok = existing.name === row.name && existing.type === row.type && existing.active && existing.baseUnitId === unit.id
                && existing.unit === row.baseUnit && same(existing.cost, row.cost) && existing.referenceCostKnown
                && existing.allowedUnits.length === 1 && existing.allowedUnits[0].unitId === unit.id && same(existing.allowedUnits[0].conversionFactor, 1, 1e-12);
            if (ok) productNoop++; else blockers.push(`${label}: ya existe con otros datos`);
            continue;
        }
        const homonym = await db.product.findFirst({ where: { companyId, active: true, name: row.name }, select: { id: true } });
        if (homonym) { blockers.push(`${label}: ya hay un producto activo llamado ${row.name} (id ${homonym.id})`); continue; }
        productCreates.push({ ...row, baseUnitId: unit.id });
    }

    const costChanges: CostRow[] = [];
    let costNoop = 0;
    for (const row of plan.productCosts ?? []) {
        const p = await db.product.findFirst({
            where: { id: row.productId, companyId },
            select: { id: true, sku: true, active: true, type: true, cost: true, referenceCostKnown: true, currentAverageCost: true },
        });
        if (!p) { blockers.push(`producto ${row.productId} no existe`); continue; }
        if (p.sku !== row.sku) { blockers.push(`producto ${row.productId}: sku ${p.sku} ≠ ${row.sku}`); continue; }
        if (!p.active || p.type === 'INTERMEDIATE') { blockers.push(`producto ${row.sku}: inactivo o intermedio`); continue; }
        if (!(row.newCost > 0) || row.newCost >= 10000) { blockers.push(`producto ${row.sku}: costo fuera de rango ${row.newCost}`); continue; }
        if (Number(p.currentAverageCost) > 0) { blockers.push(`producto ${row.sku}: ya tiene costo promedio`); continue; }
        if (same(p.cost, row.newCost) && p.referenceCostKnown) { costNoop++; continue; }
        if (!matchesOldCost(p.cost, row.oldCost)) { blockers.push(`producto ${row.sku}: costo actual ${p.cost} ≠ esperado ${row.oldCost}`); continue; }
        costChanges.push(row);
    }

    const unitChanges: UnitRow[] = [];
    for (const row of plan.productUnits ?? []) {
        const pu = await db.productUnit.findFirst({ where: { id: row.productUnitId, productId: row.productId, companyId } });
        if (!pu) { blockers.push(`ProductUnit ${row.productUnitId} no existe`); continue; }
        if (same(pu.conversionFactor, row.newFactor, 1e-12)) continue;
        if (!same(pu.conversionFactor, row.oldFactor, 1e-9)) { blockers.push(`ProductUnit ${row.productUnitId}: factor ${pu.conversionFactor} ≠ ${row.oldFactor}`); continue; }
        const history = await db.product.findUnique({
            where: { id: row.productId },
            select: { _count: { select: { inventoryMovements: true, inventoryBatches: true, purchaseOrderItems: true, productionOrderItems: true } } },
        });
        const used = Object.values(history?._count ?? {}).some(n => n > 0);
        if (used) { blockers.push(`ProductUnit ${row.productUnitId}: el producto tiene historial; no se cambia el factor`); continue; }
        unitChanges.push(row);
    }

    const lineChanges: LineRow[] = [];
    for (const row of plan.recipeLines ?? []) {
        const r = await db.recipe.findUnique({ where: { id: row.recipeId } });
        if (!r) { blockers.push(`Recipe ${row.recipeId} no existe`); continue; }
        if (r.productId === row.new.productId && same(r.quantity, row.new.quantity) && r.unitId === row.new.unitId && r.unit === row.new.unit) continue;
        if (r.productId !== row.old.productId || !same(r.quantity, row.old.quantity) || r.unitId !== row.old.unitId) {
            blockers.push(`Recipe ${row.recipeId}: no coincide con el estado esperado`); continue;
        }
        const clash = await db.recipe.findFirst({ where: { menuItemId: r.menuItemId, productId: row.new.productId } });
        if (clash) { blockers.push(`Recipe ${row.recipeId}: el plato ya tiene el producto ${row.new.productId}`); continue; }
        const target = await db.product.findFirst({ where: { id: row.new.productId, companyId, active: true } });
        if (!target) { blockers.push(`Recipe ${row.recipeId}: producto destino inactivo o inexistente`); continue; }
        lineChanges.push(row);
    }

    return { blockers, productCreates, productNoop, costChanges, costNoop, unitChanges, lineChanges };
}

async function main() {
    const file = process.argv[2];
    const apply = process.argv.includes('--apply');
    if (!file) throw new Error('Uso: reconcile-costo-recetas.ts <plan.json> [--apply]');
    const plan: Plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    const companyId = plan.companyId;

    const a = await analyze(prisma, plan);
    const report = {
        mode: apply ? 'apply' : 'dry-run', phase: plan.phase,
        changes: {
            newProducts: a.productCreates.map(p => p.sku), productCosts: a.costChanges.length,
            productUnits: a.unitChanges.length, recipeLines: a.lineChanges.length,
        },
        alreadyApplied: { newProducts: a.productNoop, productCosts: a.costNoop }, blockers: a.blockers,
    };
    console.log(JSON.stringify(report, null, 1));
    if (!apply) return;
    if (a.blockers.length) throw new Error('Hay bloqueos; no se aplicó nada.');
    if (process.env.ALLOW_RECIPE_COST_RECONCILIATION !== '1') throw new Error('Defina ALLOW_RECIPE_COST_RECONCILIATION=1 para aplicar');

    await prisma.$transaction(async tx => {
        // Re-evaluate every precondition inside the transaction (no TOCTOU window).
        const t = await analyze(tx, plan);
        if (t.blockers.length) throw new Error(`Bloqueos dentro de la transacción: ${t.blockers.join('; ')}`);
        for (const p of t.productCreates) {
            await tx.product.create({
                data: {
                    companyId, sku: p.sku, name: p.name, type: p.type, unit: p.baseUnit, baseUnitId: p.baseUnitId, categoryId: p.categoryId,
                    storageType: p.storageType ?? null, cost: p.cost, referenceCostKnown: true,
                    allowedUnits: { create: { companyId, unitId: p.baseUnitId, conversionFactor: 1, isDefault: true, active: true } },
                },
            });
        }
        for (const row of t.costChanges) {
            const res = await tx.product.updateMany({
                where: { id: row.productId, companyId, sku: row.sku },
                // Reference cost only: currentAverageCost / lastPurchaseCost stay untouched.
                data: { cost: row.newCost, referenceCostKnown: true },
            });
            if (res.count !== 1) throw new Error(`Actualización de costo ${row.sku}: ${res.count}`);
        }
        for (const row of t.unitChanges) {
            const res = await tx.productUnit.updateMany({
                where: { id: row.productUnitId, productId: row.productId },
                data: { conversionFactor: row.newFactor },
            });
            if (res.count !== 1) throw new Error(`ProductUnit ${row.productUnitId}: ${res.count}`);
        }
        for (const row of t.lineChanges) {
            await tx.recipe.update({
                where: { id: row.recipeId },
                data: { productId: row.new.productId, quantity: row.new.quantity, unit: row.new.unit, unitId: row.new.unitId },
            });
        }
    }, { timeout: Number(process.env.RECON_TX_TIMEOUT_MS || 120000) });
    console.log('Aplicado. Vuelva a ejecutar en dry-run: debe reportar 0 cambios.');
}

main()
    .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
