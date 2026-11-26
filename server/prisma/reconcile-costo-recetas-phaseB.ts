/**
 * Phase B of the recipe-costing reconciliation (prisma/data/costo-recetas-*.phaseB.json):
 * insumo reference costs, ProductUnit factors/defaults, production BOMs (new version /
 * draft edit / create), intermediate Product.cost derived from the new BOMs and
 * full replacement of the reviewed menu recipes.
 *
 * Dry-run by default. To write:
 *   ALLOW_RECIPE_COST_RECONCILIATION=1 npx ts-node --transpile-only prisma/reconcile-costo-recetas-phaseB.ts <plan.json> --apply
 * `--skip-phase-check` (dry-run only) simulates the products/costs required from phase A2
 * when A2 is not applied yet.
 *
 * Guards (impact review, sections 6/7): phase A2 applied (products by sku with their
 * costs); no open orders / production orders / pending POs; every row must match its
 * expected old value (or already be in the target state); factors only change on
 * products without inventory history; ACTIVE BOMs are never edited (version+1,
 * previous one INACTIVE, new one ACTIVE in the same transaction); DRAFT BOMs are
 * edited in place; leaves are activated before parents; the intermediate cost is
 * computed here from the new BOMs (same formula as ProductionRecipeService.computeRecipeCost,
 * children resolved first whatever the plan order) and must be within the plan tolerance;
 * averages, last purchase costs and systemFactor are never touched. With --apply the whole
 * analysis is re-run inside the single transaction, and the result is re-verified with
 * ProductionRecipeService before commit; a second run must report 0 changes.
 */
import fs from 'fs';
import { Prisma } from '@prisma/client';
import prisma from '../src/utils/prisma';
import { UnitConversionService } from '../src/services/unit-conversion.service';
import { ProductionRecipeService } from '../src/services/production-recipe.service';

type Db = Prisma.TransactionClient | typeof prisma;
type Ref = { productId: number | null; productSku?: string };
type CostRow = { productId: number; sku: string; name: string; oldCost: number; newCost: number; allowZero?: boolean };
type UnitRow = { productUnitId: number; productId: number; sku: string; unit: string; oldFactor: number; newFactor: number };
type DefaultRow = { productUnitId: number; productId: number; sku: string; unit: string; oldIsDefault: boolean; newIsDefault: boolean };
type Comp = { productId: number; qty: number; unit: string | null; unitId: number | null };
type PlanComp = Ref & { qty: number; unit: string; unitId: number };
type BomPlan = {
    key: string; productId: number; sku: string; action: 'NEW_VERSION' | 'EDIT_DRAFT' | 'CREATE';
    source: null | { recipeId: number; version: number; status: string; yield: { qty: number; unitId: number | null }; components: Comp[] };
    target: { name: string; version: number; yield: { qty: number; unit: string; unitId: number }; components: PlanComp[] };
};
type InterRow = { productId: number; sku: string; oldCost: number; expectedNewCost: number; bom: { recipeKey?: string; recipeId?: number } };
type PlanLine = Ref & { quantity: number; unit: string; unitId: number };
type Line = { productId: number; quantity: number; unit: string; unitId: number };
type MenuPlan = { menuItemId: number; name: string; old: (Line & { recipeId: number })[]; new: PlanLine[]; cost: { excelCorrected: number } };
type Required = { sku: string; productId: number | null; cost: number; baseUnit?: string };
type Plan = {
    companyId: number; phase: string; conventions: { costTolerancePct: number }; requires?: { phase: string; products: Required[] };
    productCosts: CostRow[]; productUnits: UnitRow[]; productUnitDefaults?: DefaultRow[];
    productionRecipes: BomPlan[]; intermediateCosts: InterRow[]; menuRecipes: MenuPlan[];
};

const EPS = 5e-7;
const same = (a: unknown, b: number, eps = EPS) => Math.abs(Number(a) - b) < eps;
// Production ran normalize-zero-reference-costs (0 → placeholder 1). A plan built
// from a pre-normalization snapshot expects 0; treat the exact placeholder as 0.
const matchesOldCost = (current: unknown, expected: number) =>
    same(current, expected, 0.005) || (expected === 0 && same(current, 1, 1e-9));
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const key = (c: Comp) => `${c.productId}|${round6(c.qty)}|${(c.unit ?? '').trim().toLowerCase()}|${c.unitId ?? ''}`;
const sameSet = (a: Comp[], b: Comp[]) => {
    if (a.length !== b.length) return false;
    const sa = a.map(key).sort(), sb = b.map(key).sort();
    return sa.every((x, i) => x === sb[i]);
};

async function analyze(db: Db, plan: Plan, skipPhaseCheck: boolean) {
    const companyId = plan.companyId;
    const tolerance = (plan.conventions?.costTolerancePct ?? 0.5) / 100;
    const blockers: string[] = [];

    const [openOrders, openProduction, pendingPOs] = await Promise.all([
        db.order.count({ where: { status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } } }),
        db.productionOrder.count({ where: { status: { in: ['DRAFT', 'PENDING', 'IN_PROGRESS'] } } }),
        db.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } } }),
    ]);
    // --allow-open-orders: explicit business decision (the open orders are tests); every other guard still applies.
    if (openOrders && !process.argv.includes("--allow-open-orders")) blockers.push(`${openOrders} órdenes abiertas`);
    else if (openOrders) console.error(`AVISO: ${openOrders} órdenes abiertas ignoradas por --allow-open-orders`);
    if (openProduction) blockers.push(`${openProduction} órdenes de producción abiertas`);
    if (pendingPOs) blockers.push(`${pendingPOs} OC pendientes de recibir`);

    const units = await db.unitOfMeasure.findMany({ where: { companyId }, select: { id: true, abbreviation: true, active: true } });
    const unitById = new Map(units.map(u => [u.id, u]));
    const checkUnit = (label: string, unit: string | null, unitId: number | null) => {
        const u = unitId != null ? unitById.get(unitId) : undefined;
        if (!u || !u.active || !unit || u.abbreviation.toLowerCase() !== unit.trim().toLowerCase()) {
            blockers.push(`${label}: unidad '${unit}' / unitId ${unitId} incoherente o inactiva`);
            return false;
        }
        return true;
    };

    // 0. Phase A2 precondition: required products (by sku) exist, active, with their reference cost.
    //    With --skip-phase-check (dry-run only) missing ones are simulated with a virtual id.
    const skuToId = new Map<string, number>();
    const virtual = new Map<number, Required>();
    const phaseCheckSkipped: string[] = [];
    for (const r of plan.requires?.products ?? []) {
        const p = await db.product.findFirst({ where: { companyId, sku: r.sku }, select: { id: true, active: true, cost: true, referenceCostKnown: true, baseUnit: { select: { abbreviation: true } } } });
        const ok = p && p.active && p.referenceCostKnown && same(p.cost, r.cost) && (r.productId == null || p.id === r.productId)
            && (!r.baseUnit || p.baseUnit?.abbreviation === r.baseUnit);
        if (p) skuToId.set(r.sku, p.id);
        if (ok) continue;
        if (!skipPhaseCheck) { blockers.push(`fase ${plan.requires!.phase} no aplicada: ${r.sku} ${p ? `costo ${p.cost}` : 'no existe'} (esperado ${r.cost})`); continue; }
        phaseCheckSkipped.push(r.sku);
        if (!p) { const vid = -(virtual.size + 1); virtual.set(vid, r); skuToId.set(r.sku, vid); }
        else virtual.set(p.id, r); // existing product, cost simulated
    }
    const resolve = (label: string, ref: Ref): number | null => {
        if (ref.productId != null) return ref.productId;
        const id = ref.productSku ? skuToId.get(ref.productSku) : undefined;
        if (id === undefined) { blockers.push(`${label}: sku ${ref.productSku} sin resolver`); return null; }
        return id;
    };
    const productActive = async (id: number) => virtual.has(id) && id < 0
        ? true : !!(await db.product.findFirst({ where: { id, companyId, active: true }, select: { id: true } }));

    // 1. Reference costs of insumos (never intermediates, never averages).
    const costChanges: CostRow[] = [];
    let costNoop = 0;
    for (const row of plan.productCosts) {
        const p = await db.product.findFirst({
            where: { id: row.productId, companyId },
            select: { sku: true, active: true, type: true, cost: true, referenceCostKnown: true, currentAverageCost: true },
        });
        if (!p) { blockers.push(`producto ${row.productId} no existe`); continue; }
        if (p.sku !== row.sku) { blockers.push(`producto ${row.productId}: sku ${p.sku} ≠ ${row.sku}`); continue; }
        if (!p.active || p.type === 'INTERMEDIATE') { blockers.push(`producto ${row.sku}: inactivo o intermedio`); continue; }
        const zeroOk = row.allowZero === true && row.newCost === 0;
        if (!(row.newCost > 0 || zeroOk) || row.newCost >= 10000) { blockers.push(`producto ${row.sku}: costo fuera de rango ${row.newCost}`); continue; }
        if (Number(p.currentAverageCost) > 0) { blockers.push(`producto ${row.sku}: ya tiene costo promedio; no se fija referencia`); continue; }
        if (same(p.cost, row.newCost) && p.referenceCostKnown) { costNoop++; continue; }
        if (!matchesOldCost(p.cost, row.oldCost)) { blockers.push(`producto ${row.sku}: costo actual ${p.cost} ≠ esperado ${row.oldCost}`); continue; }
        costChanges.push(row);
    }

    // 2. ProductUnit factors (only on products without inventory history) and defaults.
    const noHistory = async (productId: number) => {
        const h = await db.product.findUnique({
            where: { id: productId },
            select: { _count: { select: { inventoryMovements: true, inventoryBatches: true, purchaseOrderItems: true, productionOrderItems: true } } },
        });
        const stock = await db.stock.count({ where: { productId, NOT: { quantity: 0 } } });
        return !Object.values(h?._count ?? {}).some(n => n > 0) && stock === 0;
    };
    const unitChanges: UnitRow[] = [];
    const factorOverride = new Map<string, number>();
    for (const row of plan.productUnits) {
        const pu = await db.productUnit.findFirst({ where: { id: row.productUnitId, productId: row.productId, companyId }, include: { unit: true } });
        if (!pu) { blockers.push(`ProductUnit ${row.productUnitId} no existe`); continue; }
        if (pu.unit.abbreviation !== row.unit) { blockers.push(`ProductUnit ${row.productUnitId}: unidad ${pu.unit.abbreviation} ≠ ${row.unit}`); continue; }
        factorOverride.set(`${row.productId}:${row.unit}`, row.newFactor);
        if (same(pu.conversionFactor, row.newFactor, 1e-12)) continue;
        if (!same(pu.conversionFactor, row.oldFactor, 1e-9)) { blockers.push(`ProductUnit ${row.productUnitId}: factor ${pu.conversionFactor} ≠ ${row.oldFactor}`); continue; }
        if (!(await noHistory(row.productId))) { blockers.push(`ProductUnit ${row.productUnitId}: el producto tiene historial o stock; no se cambia el factor`); continue; }
        unitChanges.push(row);
    }
    const defaultChanges: DefaultRow[] = [];
    for (const row of plan.productUnitDefaults ?? []) {
        const pu = await db.productUnit.findFirst({ where: { id: row.productUnitId, productId: row.productId, companyId, active: true }, include: { unit: true } });
        if (!pu || pu.unit.abbreviation !== row.unit) { blockers.push(`ProductUnit ${row.productUnitId}: no existe o unidad ≠ ${row.unit}`); continue; }
        if (pu.isDefault === row.newIsDefault) continue;
        if (pu.isDefault !== row.oldIsDefault) { blockers.push(`ProductUnit ${row.productUnitId}: isDefault inesperado`); continue; }
        defaultChanges.push(row);
    }
    for (const pid of new Set((plan.productUnitDefaults ?? []).map(r => r.productId))) {
        const defaults = await db.productUnit.findMany({ where: { productId: pid, active: true, isDefault: true }, select: { id: true } });
        const after = new Set(defaults.map(d => d.id));
        for (const r of (plan.productUnitDefaults ?? []).filter(x => x.productId === pid)) r.newIsDefault ? after.add(r.productUnitId) : after.delete(r.productUnitId);
        if (after.size !== 1) blockers.push(`producto ${pid}: quedarían ${after.size} unidades por defecto`);
    }

    // Conversion to base unit with the planned ProductUnit factors applied (dry-run safe).
    const toBase = async (productId: number, qty: number, unit: string) => {
        const v = virtual.get(productId);
        if (v && productId < 0) {
            if (unit !== v.baseUnit) throw new Error(`producto simulado ${v.sku} solo admite ${v.baseUnit}`);
            return qty;
        }
        const conv = await UnitConversionService.convert(productId, companyId, qty, unit, db as Prisma.TransactionClient);
        const override = factorOverride.get(`${productId}:${unit}`);
        if (override === undefined || conv.originalUnit === conv.baseUnit) return conv.baseQuantity;
        return qty * override;
    };

    // 3. Production BOMs.
    const bomChanges: (BomPlan & { components: Comp[] })[] = [];
    const targetBomByProduct = new Map<number, { yield: BomPlan['target']['yield']; components: Comp[] }>();
    for (const b of plan.productionRecipes) {
        const label = `BOM ${b.key} (${b.sku})`;
        const out = await db.product.findFirst({ where: { id: b.productId, companyId }, select: { sku: true, active: true, type: true } });
        if (!out || out.sku !== b.sku || !out.active || out.type !== 'INTERMEDIATE') { blockers.push(`${label}: producto de salida inexistente, inactivo o no intermedio`); continue; }
        let ok = checkUnit(`${label} rendimiento`, b.target.yield.unit, b.target.yield.unitId);
        const components: Comp[] = [];
        for (const pc of b.target.components) {
            const id = resolve(label, pc);
            if (id == null) { ok = false; continue; }
            const c: Comp = { productId: id, qty: pc.qty, unit: pc.unit, unitId: pc.unitId };
            if (components.some(x => x.productId === id)) { blockers.push(`${label}: componente ${id} repetido`); ok = false; }
            if (id === b.productId) { blockers.push(`${label}: se consume a sí mismo`); ok = false; }
            if (!(c.qty > 0)) { blockers.push(`${label}: cantidad inválida en ${id}`); ok = false; }
            ok = checkUnit(`${label} componente ${id}`, c.unit, c.unitId) && ok;
            if (!(await productActive(id))) { blockers.push(`${label}: componente ${id} inactivo o inexistente`); ok = false; continue; }
            try { await toBase(id, c.qty, c.unit!); } catch (e) { blockers.push(`${label}: ${id} no convierte (${(e as Error).message})`); ok = false; }
            components.push(c);
        }
        try { await toBase(b.productId, b.target.yield.qty, b.target.yield.unit); } catch (e) { blockers.push(`${label}: rendimiento no convierte (${(e as Error).message})`); ok = false; }
        if (!ok) continue;
        targetBomByProduct.set(b.productId, { yield: b.target.yield, components });

        const all = await db.productionRecipe.findMany({ where: { companyId, productId: b.productId }, include: { components: true } });
        const asPlan = (r: (typeof all)[number]): Comp[] => r.components.map(c => ({ productId: c.componentProductId, qty: Number(c.quantity), unit: c.unit, unitId: c.unitId }));
        const matchesTarget = (r: (typeof all)[number]) => r.status === 'ACTIVE' && r.version === b.target.version
            && same(r.yieldQuantity, b.target.yield.qty) && r.yieldUnitId === b.target.yield.unitId && sameSet(asPlan(r), components);
        const actives = all.filter(r => r.status === 'ACTIVE');
        if (actives.length === 1 && matchesTarget(actives[0])) continue; // already applied
        if (b.action === 'CREATE') {
            if (all.length) { blockers.push(`${label}: se esperaba sin recetas y hay ${all.length}`); continue; }
        } else {
            const src = all.find(r => r.id === b.source?.recipeId);
            const expectedStatus = b.action === 'NEW_VERSION' ? 'ACTIVE' : 'DRAFT';
            if (!src || !b.source || src.status !== expectedStatus || src.version !== b.source.version
                || !same(src.yieldQuantity, b.source.yield.qty) || src.yieldUnitId !== b.source.yield.unitId || !sameSet(asPlan(src), b.source.components)) {
                blockers.push(`${label}: la receta origen ${b.source?.recipeId} no coincide con el estado esperado`); continue;
            }
            if (b.action === 'NEW_VERSION' && all.some(r => r.version >= b.target.version)) { blockers.push(`${label}: ya existe la versión ${b.target.version}`); continue; }
            if (b.action === 'EDIT_DRAFT' && actives.length) { blockers.push(`${label}: hay otra versión ACTIVE`); continue; }
            if (b.action === 'EDIT_DRAFT' && src.version !== b.target.version) { blockers.push(`${label}: versión destino ≠ versión del borrador`); continue; }
        }
        bomChanges.push({ ...b, components });
    }

    // 4. Intermediate costs from the new BOMs. Plan intermediates are resolved recursively,
    //    so a parent always uses its children's freshly computed cost regardless of plan order.
    const plannedRef = new Map(plan.productCosts.map(r => [r.productId, r.newCost]));
    for (const [id, r] of virtual) plannedRef.set(id, r.cost);
    const interByProduct = new Map(plan.intermediateCosts.map(r => [r.productId, r]));
    const computed = new Map<number, number>();
    const visiting = new Set<number>();
    const bomOf = async (row: InterRow) => {
        const t = targetBomByProduct.get(row.productId);
        if (t) return t;
        if (!row.bom.recipeId) return null;
        const r = await db.productionRecipe.findFirst({ where: { id: row.bom.recipeId, productId: row.productId, companyId, status: 'ACTIVE' }, include: { components: true, yieldUnit: true } });
        if (!r || !r.yieldUnit) return null;
        return {
            yield: { qty: Number(r.yieldQuantity), unit: r.yieldUnit.abbreviation, unitId: r.yieldUnitId! },
            components: r.components.map(c => ({ productId: c.componentProductId, qty: Number(c.quantity), unit: c.unit ?? unitById.get(c.unitId!)?.abbreviation ?? null, unitId: c.unitId })),
        };
    };
    const unitCostOf = async (productId: number): Promise<number> => {
        if (computed.has(productId)) return computed.get(productId)!;
        const inter = interByProduct.get(productId);
        if (inter) {
            if (visiting.has(productId)) throw new Error(`dependencia circular en ${inter.sku}`);
            visiting.add(productId);
            try {
                const bom = await bomOf(inter);
                if (!bom) throw new Error(`${inter.sku}: sin BOM en el plan o BOM no ACTIVE`);
                let batch = 0;
                for (const c of bom.components) batch += (await toBase(c.productId, c.qty, c.unit!)) * (await unitCostOf(c.productId));
                const v = round6(batch / (await toBase(productId, bom.yield.qty, bom.yield.unit)));
                computed.set(productId, v);
                return v;
            } finally { visiting.delete(productId); }
        }
        if (plannedRef.has(productId)) return plannedRef.get(productId)!;
        const p = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { cost: true, currentAverageCost: true, referenceCostKnown: true, name: true, type: true } });
        // Products outside the plan (intermediates included) use their stored cost, as ProductionRecipeService does.
        const v = Number(p.currentAverageCost) > 0 ? Number(p.currentAverageCost) : Number(p.cost);
        if (!(v > 0) && !p.referenceCostKnown) blockers.push(`componente ${productId} ${p.name} sin costo conocido`);
        return v;
    };
    const interChanges: { row: InterRow; newCost: number }[] = [];
    let interNoop = 0;
    for (const row of plan.intermediateCosts) {
        const label = `costo intermedio ${row.sku}`;
        try {
            const newCost = await unitCostOf(row.productId);
            if (!(newCost > 0) || newCost >= 10000) { blockers.push(`${label}: costo calculado fuera de rango ${newCost}`); continue; }
            if (Math.abs(newCost / row.expectedNewCost - 1) > tolerance) { blockers.push(`${label}: calculado ${newCost} vs esperado ${row.expectedNewCost} (> ${tolerance * 100}%)`); continue; }
            const p = await db.product.findFirstOrThrow({ where: { id: row.productId, companyId }, select: { sku: true, type: true, cost: true, referenceCostKnown: true, currentAverageCost: true } });
            if (p.sku !== row.sku || p.type !== 'INTERMEDIATE') { blockers.push(`${label}: sku/tipo inesperado`); continue; }
            if (Number(p.currentAverageCost) > 0) { blockers.push(`${label}: tiene costo promedio; Product.cost no manda`); continue; }
            if (same(p.cost, newCost, 1e-6) && p.referenceCostKnown) { interNoop++; continue; }
            if (!matchesOldCost(p.cost, row.oldCost)) { blockers.push(`${label}: costo actual ${p.cost} ≠ esperado ${row.oldCost}`); continue; }
            interChanges.push({ row, newCost });
        } catch (e) { blockers.push(`${label}: ${(e as Error).message}`); }
    }

    // 5. Menu recipes: full replacement per dish.
    const menuChanges: { menuItemId: number; lines: Line[] }[] = [];
    const dishCosts: Record<string, { cost: number; excel: number; pct: number }> = {};
    for (const m of plan.menuRecipes) {
        const label = `plato ${m.menuItemId} ${m.name}`;
        const mi = await db.menuItem.findFirst({ where: { id: m.menuItemId }, select: { name: true, active: true, type: true } });
        if (!mi || mi.name !== m.name) { blockers.push(`${label}: no existe o cambió de nombre`); continue; }
        if (!m.new.length) { blockers.push(`${label}: receta nueva vacía`); continue; }
        let ok = true; let cost = 0;
        const lines: Line[] = [];
        for (const pl of m.new) {
            const id = resolve(label, pl);
            if (id == null) { ok = false; continue; }
            if (lines.some(l => l.productId === id)) { blockers.push(`${label}: producto ${id} repetido`); ok = false; continue; }
            lines.push({ productId: id, quantity: pl.quantity, unit: pl.unit, unitId: pl.unitId });
            ok = checkUnit(`${label} producto ${id}`, pl.unit, pl.unitId) && ok;
            if (!(await productActive(id))) { blockers.push(`${label}: producto ${id} inactivo o inexistente`); ok = false; continue; }
            try { cost += (await toBase(id, pl.quantity, pl.unit)) * (await unitCostOf(id)); }
            catch (e) { blockers.push(`${label}: ${id} no convierte (${(e as Error).message})`); ok = false; }
        }
        if (!ok) continue;
        dishCosts[`${m.menuItemId} ${m.name}`] = { cost: round6(cost), excel: m.cost.excelCorrected, pct: Math.round((cost / m.cost.excelCorrected - 1) * 10000) / 100 };
        const current = await db.recipe.findMany({ where: { menuItemId: m.menuItemId } });
        const cur = current.map(r => ({ productId: r.productId, qty: Number(r.quantity), unit: r.unit, unitId: r.unitId }));
        const asComp = (l: Line): Comp => ({ productId: l.productId, qty: l.quantity, unit: l.unit, unitId: l.unitId });
        if (sameSet(cur, lines.map(asComp))) continue;
        if (!sameSet(cur, m.old.map(asComp))) { blockers.push(`${label}: las líneas actuales no coinciden con el snapshot`); continue; }
        if (lines.some(l => l.productId < 0)) continue; // simulated product: counted in dish cost only (dry-run)
        menuChanges.push({ menuItemId: m.menuItemId, lines });
    }
    const simulatedDishes = plan.menuRecipes.filter(m => !menuChanges.some(c => c.menuItemId === m.menuItemId)
        && m.new.some(l => l.productId == null && virtual.has(skuToId.get(l.productSku!) ?? 0))).map(m => m.menuItemId);

    return { blockers, phaseCheckSkipped, simulatedDishes, costChanges, costNoop, unitChanges, defaultChanges, bomChanges, interChanges, interNoop, menuChanges, dishCosts };
}

async function main() {
    const file = process.argv[2];
    const apply = process.argv.includes('--apply');
    const skipPhaseCheck = process.argv.includes('--skip-phase-check');
    if (!file) throw new Error('Uso: reconcile-costo-recetas-phaseB.ts <plan.json> [--apply] [--skip-phase-check (solo dry-run)]');
    if (apply && skipPhaseCheck) throw new Error('--skip-phase-check solo se admite en dry-run');
    const plan: Plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (plan.phase !== 'B') throw new Error('El plan no es de fase B');
    const companyId = plan.companyId;

    const a = await analyze(prisma, plan, skipPhaseCheck);
    const report = {
        mode: apply ? 'apply' : 'dry-run', phase: plan.phase,
        ...(skipPhaseCheck ? { phaseCheckSkipped: a.phaseCheckSkipped, simulatedDishes: a.simulatedDishes } : {}),
        changes: {
            productCosts: a.costChanges.length, productUnits: a.unitChanges.length, productUnitDefaults: a.defaultChanges.length,
            productionRecipes: a.bomChanges.map(b => `${b.key}:${b.action}`), intermediateCosts: a.interChanges.map(c => `${c.row.sku} ${c.row.oldCost}→${c.newCost}`),
            menuRecipes: a.menuChanges.length,
        },
        alreadyApplied: { productCosts: a.costNoop, intermediateCosts: a.interNoop },
        dishCostsAfter: a.dishCosts,
        blockers: a.blockers,
    };
    console.log(JSON.stringify(report, null, 1));
    if (!apply) return;
    if (a.blockers.length) throw new Error('Hay bloqueos; no se aplicó nada.');
    if (process.env.ALLOW_RECIPE_COST_RECONCILIATION !== '1') throw new Error('Defina ALLOW_RECIPE_COST_RECONCILIATION=1 para aplicar');

    await prisma.$transaction(async tx => {
        // Re-run every precondition and state check inside the transaction (no TOCTOU window).
        const t = await analyze(tx, plan, false);
        if (t.blockers.length) throw new Error(`Bloqueos dentro de la transacción: ${t.blockers.join('; ')}`);
        // Order (precondition 14): units → reference costs → BOM (leaves first) → intermediate costs → menu recipes.
        for (const row of t.unitChanges) {
            const res = await tx.productUnit.updateMany({ where: { id: row.productUnitId, productId: row.productId }, data: { conversionFactor: row.newFactor } });
            if (res.count !== 1) throw new Error(`ProductUnit ${row.productUnitId}: ${res.count}`);
        }
        for (const row of [...t.defaultChanges].sort((x, y) => Number(x.newIsDefault) - Number(y.newIsDefault))) {
            const res = await tx.productUnit.updateMany({ where: { id: row.productUnitId, productId: row.productId }, data: { isDefault: row.newIsDefault } });
            if (res.count !== 1) throw new Error(`ProductUnit default ${row.productUnitId}: ${res.count}`);
        }
        for (const row of t.costChanges) {
            const res = await tx.product.updateMany({ where: { id: row.productId, companyId, sku: row.sku }, data: { cost: row.newCost, referenceCostKnown: true } });
            if (res.count !== 1) throw new Error(`Actualización de costo ${row.sku}: ${res.count}`);
        }
        for (const b of t.bomChanges) {
            const components = b.components.map(c => ({ componentProductId: c.productId, quantity: c.qty, unit: c.unit, unitId: c.unitId }));
            if (b.action === 'EDIT_DRAFT') {
                const id = b.source!.recipeId;
                await tx.productionRecipeComponent.deleteMany({ where: { recipeId: id } });
                await tx.productionRecipe.update({
                    where: { id },
                    data: { name: b.target.name, yieldQuantity: b.target.yield.qty, yieldUnitId: b.target.yield.unitId, status: 'ACTIVE', components: { create: components } },
                });
            } else {
                await tx.productionRecipe.updateMany({ where: { companyId, productId: b.productId, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
                await tx.productionRecipe.create({
                    data: {
                        companyId, productId: b.productId, name: b.target.name, version: b.target.version, status: 'ACTIVE',
                        yieldQuantity: b.target.yield.qty, yieldUnitId: b.target.yield.unitId,
                        notes: `COSTO RECETAS.xlsx ${b.key} (fase B 2026-11-19)`, components: { create: components },
                    },
                });
            }
        }
        for (const { row, newCost } of t.interChanges) {
            const res = await tx.product.updateMany({ where: { id: row.productId, companyId, sku: row.sku }, data: { cost: newCost, referenceCostKnown: true } });
            if (res.count !== 1) throw new Error(`Costo intermedio ${row.sku}: ${res.count}`);
        }
        for (const m of t.menuChanges) {
            await tx.recipe.deleteMany({ where: { menuItemId: m.menuItemId } });
            await tx.recipe.createMany({ data: m.lines.map(l => ({ menuItemId: m.menuItemId, productId: l.productId, quantity: l.quantity, unit: l.unit, unitId: l.unitId })) });
        }
        // Post-checks inside the transaction (V-7, V-9, V-10): any failure rolls everything back.
        for (const row of plan.intermediateCosts) {
            const active = await tx.productionRecipe.findMany({ where: { companyId, productId: row.productId, status: 'ACTIVE' }, select: { id: true } });
            if (active.length !== 1) throw new Error(`${row.sku}: ${active.length} BOM ACTIVE`);
            const bomCost = await ProductionRecipeService.computeRecipeCost(active[0].id, companyId, tx);
            const p = await tx.product.findUniqueOrThrow({ where: { id: row.productId }, select: { cost: true } });
            if (!same(p.cost, bomCost.unitCost, 2e-6)) throw new Error(`${row.sku}: Product.cost ${p.cost} ≠ costo BOM ${bomCost.unitCost}`);
        }
        for (const m of plan.menuRecipes) {
            if (!(await tx.recipe.count({ where: { menuItemId: m.menuItemId } }))) throw new Error(`plato ${m.menuItemId} sin líneas`);
        }
    }, { timeout: Number(process.env.RECON_TX_TIMEOUT_MS || 300000), maxWait: 10000 });
    console.log('Aplicado. Vuelva a ejecutar en dry-run: debe reportar 0 cambios.');
}

main()
    .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
