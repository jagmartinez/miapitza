/**
 * Phase C of the recipe-costing reconciliation (prisma/data/costo-recetas-*.phaseC.json):
 * creates the dishes of "COSTO RECETAS.xlsx" that have no MenuItem, their new
 * intermediates (Product INTERMEDIATE + base ProductUnit + ProductionRecipe v1 ACTIVE),
 * the "Otros" menu category, and sets the reference cost of the insumos listed in
 * productCosts. Insumos created by phase A2 (FRESA CONGELADA, SAZONADOR DE POLLO) are
 * referenced by name, never created here.
 *
 * Dry-run by default. To write (phases A2 and B must already be applied):
 *   ALLOW_RECIPE_COST_RECONCILIATION=1 npx ts-node --transpile-only prisma/reconcile-costo-recetas-phaseC.ts <plan.json> --apply
 * Dry-run before phase B is applied:
 *   npx ts-node --transpile-only prisma/reconcile-costo-recetas-phaseC.ts <plan.json> --skip-phase-check
 *   (phase-B mismatches become warnings and the B costs of the plan replace the DB ones; never with --apply)
 *
 * Guards (same as phase B): no open orders / production orders / pending POs; phase B
 * applied (one ACTIVE BOM per B product with the expected version/yield and Product.cost);
 * phase A2 products present; menu brand active and of the company; reference costs only
 * change from their expected old value; SKUs and names not taken by other products; no
 * MenuItem duplicated (normalized name); intermediates' cost computed here, leaves first,
 * with the ProductionRecipeService formula (Σ base qty × unit cost ÷ yield in base) and
 * within the plan tolerance. The whole analysis runs again inside the single transaction
 * (no TOCTOU window) and must yield the same change set; the result is re-verified with
 * ProductionRecipeService.computeRecipeCost before commit; a second run reports 0 changes.
 */
import fs from 'fs';
import { Prisma } from '@prisma/client';
import prisma from '../src/utils/prisma';
import { UnitConversionService } from '../src/services/unit-conversion.service';
import { ProductionRecipeService } from '../src/services/production-recipe.service';

type Db = Prisma.TransactionClient;
type Ref = { productId?: number; newKey?: string };
type Comp = Ref & { qty: number; unit: string; unitId: number };
type Line = Ref & { quantity: number; unit: string; unitId: number };
type CostRow = { productId: number; sku: string; name: string; oldCost: number; newCost: number };
type External = { key: string; name: string; baseUnit: string; expectedCost: number; source: string };
type NewProduct = { key: string; sku: string; name: string; type: 'INTERMEDIATE'; categoryId: number; baseUnit: string; baseUnitId: number; storageType: string; expectedCost: number; note?: string | null };
type PU = { productKey: string; unit: string; unitId: number; conversionFactor: number; isDefault: boolean };
type Bom = { key: string; productKey: string; name: string; version: number; excelRows: string; yield: { qty: number; unit: string; unitId: number }; components: Comp[]; expected: { unitCost: number } };
type Category = { key: string; id: number | null; name: string; create?: { description: string; sortOrder: number; showInMenu: boolean; showInInventory: boolean } };
type Dish = { key: string; name: string; categoryKey: string; lines: Line[]; cost: { expected: number; excelCorrected: number } };
type Plan = {
    companyId: number; phase: string; conventions: { costTolerancePct: number };
    preconditions: { phaseB: { productId: number; sku: string; activeVersion: number; yieldQty: number; cost: number }[] };
    categories: Category[]; menuDefaults: { active: boolean; price: number; type: 'PREPARED'; branchId: number | null; brandId: number | null };
    productCosts: CostRow[]; externalProducts: External[]; newProducts: NewProduct[]; productUnits: PU[]; productionRecipes: Bom[]; menuItems: Dish[];
};

const EPS = 5e-7;
const same = (a: unknown, b: number, eps = EPS) => Math.abs(Number(a) - b) < eps;
// Production ran normalize-zero-reference-costs (0 → placeholder 1). A plan built
// from a pre-normalization snapshot expects 0; treat the exact placeholder as 0.
const matchesOldCost = (current: unknown, expected: number) =>
    same(current, expected, 0.005) || (expected === 0 && same(current, 1, 1e-9));
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const sig = (rows: { productId: number; qty: number; unitId: number | null }[]) =>
    rows.map(r => `${r.productId}|${round6(r.qty)}|${r.unitId ?? ''}`).sort().join(';');
const refKey = (r: Ref) => r.newKey ?? `#${r.productId}`;

async function analyze(db: Db, plan: Plan, skipPhaseCheck: boolean) {
    const companyId = plan.companyId;
    const tolerance = (plan.conventions?.costTolerancePct ?? 0.5) / 100;
    const blockers: string[] = [];
    const warnings: string[] = [];

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
    const checkUnit = (label: string, unit: string, unitId: number) => {
        const u = unitById.get(unitId);
        if (!u || !u.active || u.abbreviation.toLowerCase() !== unit.trim().toLowerCase()) {
            blockers.push(`${label}: unidad '${unit}' / unitId ${unitId} incoherente o inactiva`);
            return false;
        }
        return true;
    };

    // 0. Phase B applied? (its intermediates feed C: 402/403/406/373...)
    const costOverride = new Map<number, number>();
    for (const b of plan.preconditions.phaseB) {
        const p = await db.product.findFirst({ where: { id: b.productId, companyId }, select: { sku: true, cost: true } });
        const actives = await db.productionRecipe.findMany({ where: { companyId, productId: b.productId, status: 'ACTIVE' }, select: { version: true, yieldQuantity: true } });
        const ok = p?.sku === b.sku && actives.length === 1 && actives[0].version === b.activeVersion
            && same(actives[0].yieldQuantity, b.yieldQty, 1e-5) && same(p.cost, b.cost, 1e-6);
        if (ok) continue;
        const msg = `fase B no aplicada en ${b.sku}: ACTIVE ${actives.map(a => `v${a.version}`).join(',') || 'ninguna'} (esperada v${b.activeVersion}), costo ${p?.cost} (esperado ${b.cost})`;
        if (skipPhaseCheck) { warnings.push(msg); costOverride.set(b.productId, b.cost); } else blockers.push(msg);
    }

    // 1. Menu brand.
    const brandId = plan.menuDefaults.brandId;
    if (brandId != null) {
        const brand = await db.menuBrand.findFirst({ where: { id: brandId, companyId } });
        if (!brand || !brand.active) blockers.push(`marca ${brandId} inexistente, inactiva o de otra compañía`);
    }

    // 2. Reference costs of insumos (never intermediates, never averages).
    const plannedRef = new Map<number, number>();
    const costChanges: CostRow[] = [];
    for (const row of plan.productCosts) {
        const p = await db.product.findFirst({ where: { id: row.productId, companyId }, select: { sku: true, active: true, type: true, cost: true, referenceCostKnown: true, currentAverageCost: true } });
        if (!p || p.sku !== row.sku) { blockers.push(`producto ${row.productId}: inexistente o sku ≠ ${row.sku}`); continue; }
        if (!p.active || p.type === 'INTERMEDIATE') { blockers.push(`producto ${row.sku}: inactivo o intermedio`); continue; }
        if (!(row.newCost > 0) || row.newCost >= 10000) { blockers.push(`producto ${row.sku}: costo fuera de rango ${row.newCost}`); continue; }
        if (Number(p.currentAverageCost) > 0) { blockers.push(`producto ${row.sku}: ya tiene costo promedio; no se fija referencia`); continue; }
        plannedRef.set(row.productId, row.newCost);
        if (same(p.cost, row.newCost) && p.referenceCostKnown) continue;
        if (!matchesOldCost(p.cost, row.oldCost)) { blockers.push(`producto ${row.sku}: costo actual ${p.cost} ≠ esperado ${row.oldCost}`); continue; }
        costChanges.push(row);
    }

    // 3. Phase A2 products (referenced by name, never created here).
    const allProducts = await db.product.findMany({ where: { companyId }, select: { id: true, sku: true, name: true, active: true } });
    const keyToId = new Map<string, number>();
    const keyCost = new Map<string, number>();
    const keyBase = new Map<string, string>();
    for (const x of plan.externalProducts) {
        const hits = allProducts.filter(p => p.active && norm(p.name) === norm(x.name));
        keyBase.set(x.key, x.baseUnit);
        if (hits.length !== 1) {
            blockers.push(`${x.name}: ${hits.length ? `${hits.length} productos activos con ese nombre` : `no existe (lo crea la fase ${x.source}; aplicarla antes)`}`);
            keyCost.set(x.key, x.expectedCost);
            continue;
        }
        const p = await db.product.findUniqueOrThrow({ where: { id: hits[0].id }, select: { id: true, cost: true, currentAverageCost: true, referenceCostKnown: true, baseUnit: { select: { abbreviation: true } } } });
        const v = Number(p.currentAverageCost) > 0 ? Number(p.currentAverageCost) : Number(p.cost);
        if (p.baseUnit?.abbreviation !== x.baseUnit) blockers.push(`${x.name}: unidad base ${p.baseUnit?.abbreviation} ≠ ${x.baseUnit}`);
        if (!(v > 0) || !p.referenceCostKnown) blockers.push(`${x.name}: sin costo conocido`);
        if (v > 0 && Math.abs(v / x.expectedCost - 1) > tolerance) warnings.push(`${x.name}: costo ${v} vs esperado ${x.expectedCost}`);
        keyToId.set(x.key, p.id);
        keyCost.set(x.key, v);
    }

    // 4. Categories.
    const catToCreate: Category[] = [];
    const catId = new Map<string, number>();
    for (const c of plan.categories) {
        const found = await db.category.findFirst({ where: { companyId, name: c.name } });
        if (c.id != null) {
            if (!found || found.id !== c.id || !found.active || !found.showInMenu) blockers.push(`categoría ${c.id} ${c.name} inexistente, inactiva o no visible en menú`);
            else catId.set(c.key, c.id);
        } else if (found) {
            if (!found.active || !found.showInMenu) blockers.push(`categoría existente ${c.name} inactiva o no visible en menú`);
            else catId.set(c.key, found.id);
        } else catToCreate.push(c);
    }

    // 5. New intermediates: detect previous runs by SKU, refuse name/SKU collisions.
    const npToCreate: NewProduct[] = [];
    const puToCreate: PU[] = [];
    const newByKey = new Map(plan.newProducts.map(p => [p.key, p]));
    for (const np of plan.newProducts) {
        keyBase.set(np.key, np.baseUnit);
        if (!checkUnit(`producto ${np.sku}`, np.baseUnit, np.baseUnitId)) continue;
        const bySku = await db.product.findFirst({ where: { companyId, sku: np.sku }, select: { id: true, name: true, type: true, baseUnitId: true, active: true } });
        const sameName = allProducts.filter(p => norm(p.name) === norm(np.name) && p.sku !== np.sku);
        if (sameName.length) { blockers.push(`producto ${np.name}: ya existe con otro SKU (${sameName.map(p => `${p.id} ${p.sku}`).join(', ')})`); continue; }
        if (bySku) {
            if (norm(bySku.name) !== norm(np.name) || bySku.type !== 'INTERMEDIATE' || bySku.baseUnitId !== np.baseUnitId || !bySku.active) {
                blockers.push(`SKU ${np.sku} ocupado por ${bySku.id} ${bySku.name}`); continue;
            }
            keyToId.set(np.key, bySku.id);
        } else npToCreate.push(np);
    }
    for (const pu of plan.productUnits) {
        const np = newByKey.get(pu.productKey);
        if (!np || pu.unitId !== np.baseUnitId || pu.conversionFactor !== 1) { blockers.push(`ProductUnit ${pu.productKey}: debe ser la unidad base con factor 1`); continue; }
        const id = keyToId.get(pu.productKey);
        if (id) {
            const cur = await db.productUnit.findFirst({ where: { productId: id, unitId: pu.unitId } });
            if (cur && same(cur.conversionFactor, 1, 1e-12) && cur.active) continue;
            if (cur) { blockers.push(`ProductUnit ${pu.productKey}: existe con factor ${cur.conversionFactor}`); continue; }
        }
        puToCreate.push(pu);
    }

    // 6. Conversion and unit cost helpers. Planned/new products are always used in their base unit.
    const computed = new Map<string, number>();
    const unitCostOf = async (r: Ref): Promise<number> => {
        if (r.newKey) {
            if (computed.has(r.newKey)) return computed.get(r.newKey)!;
            if (keyCost.has(r.newKey)) return keyCost.get(r.newKey)!;
            throw new Error(`${r.newKey} se usa antes de definirse (orden hojas → padres)`);
        }
        const id = r.productId!;
        if (plannedRef.has(id)) return plannedRef.get(id)!;
        if (costOverride.has(id)) return costOverride.get(id)!;
        const p = await db.product.findUniqueOrThrow({ where: { id }, select: { cost: true, currentAverageCost: true, referenceCostKnown: true, name: true } });
        const v = Number(p.currentAverageCost) > 0 ? Number(p.currentAverageCost) : Number(p.cost);
        if (!(v > 0) && !p.referenceCostKnown) blockers.push(`componente ${id} ${p.name} sin costo conocido`);
        return v;
    };
    const toBase = async (r: Ref, qty: number, unit: string): Promise<number> => {
        if (r.newKey) {
            if (keyBase.get(r.newKey) !== unit) throw new Error(`${r.newKey} debe usarse en su unidad base ${keyBase.get(r.newKey)}`);
            return qty;
        }
        return (await UnitConversionService.convert(r.productId!, companyId, qty, unit, db)).baseQuantity;
    };
    const checkRef = async (label: string, r: Ref) => {
        if (r.newKey) {
            if (!newByKey.has(r.newKey) && !plan.externalProducts.some(x => x.key === r.newKey)) { blockers.push(`${label}: clave ${r.newKey} desconocida`); return false; }
            return true;
        }
        const p = await db.product.findFirst({ where: { id: r.productId, companyId, active: true }, select: { id: true } });
        if (!p) { blockers.push(`${label}: producto ${r.productId} inactivo o inexistente`); return false; }
        return true;
    };

    // 7. BOMs (plan order = leaves first) and intermediate costs.
    const bomToCreate: Bom[] = [];
    const costs: Record<string, { computed: number; expected: number; pct: number }> = {};
    for (const b of plan.productionRecipes) {
        const label = `BOM ${b.key}`;
        const np = newByKey.get(b.productKey);
        if (!np) { blockers.push(`${label}: producto de salida desconocido`); continue; }
        let ok = checkUnit(`${label} rendimiento`, b.yield.unit, b.yield.unitId) && b.yield.unitId === np.baseUnitId && b.yield.qty > 0;
        const seen = new Set<string>();
        let batch = 0;
        for (const c of b.components) {
            const ck = refKey(c);
            if (seen.has(ck)) { blockers.push(`${label}: componente ${ck} repetido`); ok = false; }
            seen.add(ck);
            if (c.newKey === b.productKey) { blockers.push(`${label}: se consume a sí mismo`); ok = false; }
            if (c.productId === 404) { blockers.push(`${label}: Agua de proceso no admitida en BOM nuevo`); ok = false; }
            if (!(c.qty > 0)) { blockers.push(`${label}: cantidad inválida en ${ck}`); ok = false; }
            ok = checkUnit(`${label} componente ${ck}`, c.unit, c.unitId) && ok;
            if (!(await checkRef(label, c))) { ok = false; continue; }
            try { batch += (await toBase(c, c.qty, c.unit)) * (await unitCostOf(c)); }
            catch (e) { blockers.push(`${label}: ${ck} ${(e as Error).message}`); ok = false; }
        }
        if (!ok) continue;
        const unitCost = round6(batch / b.yield.qty);
        computed.set(b.productKey, unitCost);
        costs[b.key] = { computed: unitCost, expected: b.expected.unitCost, pct: Math.round((unitCost / b.expected.unitCost - 1) * 10000) / 100 };
        if (!(unitCost > 0) || unitCost >= 10000) { blockers.push(`${label}: costo fuera de rango ${unitCost}`); continue; }
        if (Math.abs(unitCost / b.expected.unitCost - 1) > tolerance) blockers.push(`${label}: costo ${unitCost} vs plan ${b.expected.unitCost} (> ${tolerance * 100}%)`);

        const outId = keyToId.get(b.productKey);
        const existing = outId ? await db.productionRecipe.findMany({ where: { companyId, productId: outId }, include: { components: true } }) : [];
        if (!existing.length) { bomToCreate.push(b); continue; }
        const target = b.components.map(c => ({ productId: c.productId ?? keyToId.get(c.newKey!) ?? -1, qty: c.qty, unitId: c.unitId }));
        const cur = existing[0];
        if (existing.length === 1 && cur.status === 'ACTIVE' && cur.version === b.version && same(cur.yieldQuantity, b.yield.qty) && cur.yieldUnitId === b.yield.unitId
            && sig(cur.components.map(x => ({ productId: x.componentProductId, qty: Number(x.quantity), unitId: x.unitId }))) === sig(target)) continue;
        blockers.push(`${label}: el producto ${outId} ya tiene recetas que no coinciden con el plan`);
    }
    // Product.cost of already-created intermediates must follow the computed cost.
    const costSync: { key: string; productId: number; cost: number }[] = [];
    for (const np of plan.newProducts) {
        const id = keyToId.get(np.key); const v = computed.get(np.key);
        if (!id || v === undefined) continue;
        const p = await db.product.findUniqueOrThrow({ where: { id }, select: { cost: true, currentAverageCost: true, referenceCostKnown: true } });
        if (Number(p.currentAverageCost) > 0) { warnings.push(`${np.sku}: ya tiene costo promedio; Product.cost no se toca`); continue; }
        if (!same(p.cost, v, 1e-6) || !p.referenceCostKnown) costSync.push({ key: np.key, productId: id, cost: v });
    }

    // 8. Menu items (idempotent by normalized name).
    const menus = await db.menuItem.findMany({ where: { companyId }, select: { id: true, name: true } });
    const dishToCreate: Dish[] = [];
    const dishCosts: Record<string, { cost: number; plan: number; excelCorrected: number; pctVsExcel: number }> = {};
    for (const m of plan.menuItems) {
        const label = `plato ${m.name}`;
        if (!catId.has(m.categoryKey) && !catToCreate.some(c => c.key === m.categoryKey)) { blockers.push(`${label}: categoría ${m.categoryKey} no resuelta`); continue; }
        if (!m.lines.length) { blockers.push(`${label}: receta vacía`); continue; }
        if (new Set(m.lines.map(refKey)).size !== m.lines.length) { blockers.push(`${label}: producto repetido`); continue; }
        let ok = true; let cost = 0;
        for (const l of m.lines) {
            ok = checkUnit(`${label} ${refKey(l)}`, l.unit, l.unitId) && ok;
            if (!(l.quantity > 0)) { blockers.push(`${label}: cantidad inválida`); ok = false; }
            if (!(await checkRef(label, l))) { ok = false; continue; }
            try { cost += (await toBase(l, l.quantity, l.unit)) * (await unitCostOf(l)); }
            catch (e) { blockers.push(`${label}: ${refKey(l)} ${(e as Error).message}`); ok = false; }
        }
        if (!ok) continue;
        dishCosts[m.name] = { cost: Math.round(cost * 100) / 100, plan: m.cost.expected, excelCorrected: m.cost.excelCorrected, pctVsExcel: Math.round((cost / m.cost.excelCorrected - 1) * 10000) / 100 };
        if (Math.abs(cost / m.cost.expected - 1) > tolerance) warnings.push(`${label}: costo ${cost.toFixed(2)} vs plan ${m.cost.expected}`);
        const dup = menus.filter(x => norm(x.name) === norm(m.name));
        if (dup.length > 1) { blockers.push(`${label}: ${dup.length} MenuItem con ese nombre`); continue; }
        if (dup.length === 1) {
            const cur = await db.recipe.findMany({ where: { menuItemId: dup[0].id } });
            const target = m.lines.map(l => ({ productId: l.productId ?? keyToId.get(l.newKey!) ?? -1, qty: l.quantity, unitId: l.unitId }));
            if (sig(cur.map(r => ({ productId: r.productId, qty: Number(r.quantity), unitId: r.unitId }))) !== sig(target)) blockers.push(`${label}: ya existe (MenuItem ${dup[0].id}) con receta distinta; no se duplica`);
            continue;
        }
        dishToCreate.push(m);
    }

    const changes = {
        productCosts: costChanges.map(c => `${c.sku} ${c.oldCost}→${c.newCost}`),
        categories: catToCreate.map(c => c.name), products: npToCreate.map(p => `${p.sku} ${p.name}`), productUnits: puToCreate.map(p => p.productKey),
        productionRecipes: bomToCreate.map(b => `${b.key}:CREATE v${b.version}`), costSync: costSync.map(c => `${c.key} ${c.cost}`),
        menuItems: dishToCreate.map(d => d.name),
    };
    return { blockers, warnings, changes, costs, dishCosts, costChanges, catToCreate, catId, npToCreate, puToCreate, bomToCreate, costSync, dishToCreate, computed, keyToId };
}

async function main() {
    const file = process.argv[2];
    const apply = process.argv.includes('--apply');
    const skipPhaseCheck = process.argv.includes('--skip-phase-check');
    if (!file) throw new Error('Uso: reconcile-costo-recetas-phaseC.ts <plan.json> [--apply | --skip-phase-check]');
    if (apply && skipPhaseCheck) throw new Error('--skip-phase-check solo se admite en dry-run');
    const plan: Plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (plan.phase !== 'C') throw new Error('El plan no es de fase C');
    const companyId = plan.companyId;

    const pre = await analyze(prisma, plan, skipPhaseCheck);
    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run', phase: plan.phase, skipPhaseCheck, brandId: plan.menuDefaults.brandId,
        changes: pre.changes, intermediateCosts: pre.costs, dishCosts: pre.dishCosts, warnings: pre.warnings, blockers: pre.blockers,
    }, null, 1));
    if (!apply) return;
    if (pre.blockers.length) throw new Error('Hay bloqueos; no se aplicó nada.');
    if (process.env.ALLOW_RECIPE_COST_RECONCILIATION !== '1') throw new Error('Defina ALLOW_RECIPE_COST_RECONCILIATION=1 para aplicar');

    await prisma.$transaction(async tx => {
        // Re-run every check inside the transaction: same state, same change set, or nothing is written.
        const a = await analyze(tx, plan, false);
        if (a.blockers.length) throw new Error(`Bloqueos dentro de la transacción: ${a.blockers.join(' | ')}`);
        if (JSON.stringify(a.changes) !== JSON.stringify(pre.changes)) throw new Error('El estado cambió entre el análisis y la transacción; vuelva a ejecutar el dry-run');
        const { catId, keyToId, computed } = a;

        // Order: reference costs → categories → products → ProductUnits → BOMs (leaves first) → cost sync → menu items.
        for (const row of a.costChanges) {
            const res = await tx.product.updateMany({ where: { id: row.productId, companyId, sku: row.sku }, data: { cost: row.newCost, referenceCostKnown: true } });
            if (res.count !== 1) throw new Error(`Actualización de costo ${row.sku}: ${res.count}`);
        }
        for (const c of a.catToCreate) {
            const created = await tx.category.create({ data: { companyId, name: c.name, ...c.create! } });
            catId.set(c.key, created.id);
        }
        for (const np of a.npToCreate) {
            const created = await tx.product.create({
                data: {
                    companyId, sku: np.sku, name: np.name, type: 'INTERMEDIATE', categoryId: np.categoryId, unit: np.baseUnit, baseUnitId: np.baseUnitId,
                    storageType: np.storageType as 'PERISHABLE', cost: computed.get(np.key)!, referenceCostKnown: true,
                    observation: `COSTO RECETAS.xlsx fase C 2026-11-19${np.note ? `; ${np.note}` : ''}`,
                },
            });
            keyToId.set(np.key, created.id);
        }
        for (const pu of a.puToCreate) {
            await tx.productUnit.create({ data: { companyId, productId: keyToId.get(pu.productKey)!, unitId: pu.unitId, conversionFactor: pu.conversionFactor, isDefault: pu.isDefault } });
        }
        const resolve = (r: Ref) => r.productId ?? keyToId.get(r.newKey!)!;
        for (const b of a.bomToCreate) {
            await tx.productionRecipe.create({
                data: {
                    companyId, productId: keyToId.get(b.productKey)!, name: b.name, version: b.version, status: 'ACTIVE',
                    yieldQuantity: b.yield.qty, yieldUnitId: b.yield.unitId, notes: `COSTO RECETAS.xlsx ${b.excelRows} (fase C 2026-11-19)`,
                    components: { create: b.components.map(c => ({ componentProductId: resolve(c), quantity: c.qty, unit: c.unit, unitId: c.unitId })) },
                },
            });
        }
        for (const c of a.costSync) {
            const res = await tx.product.updateMany({ where: { id: c.productId, companyId }, data: { cost: c.cost, referenceCostKnown: true } });
            if (res.count !== 1) throw new Error(`Costo ${c.key}: ${res.count}`);
        }
        const d = plan.menuDefaults;
        for (const m of a.dishToCreate) {
            await tx.menuItem.create({
                data: {
                    companyId, branchId: d.branchId, brandId: d.brandId, categoryId: catId.get(m.categoryKey)!, name: m.name, price: d.price, active: d.active, type: d.type,
                    recipes: { create: m.lines.map(l => ({ productId: resolve(l), quantity: l.quantity, unit: l.unit, unitId: l.unitId })) },
                },
            });
        }
        // Post-checks inside the transaction: any failure rolls everything back.
        for (const row of plan.productCosts) {
            const p = await tx.product.findUniqueOrThrow({ where: { id: row.productId }, select: { cost: true } });
            if (!same(p.cost, row.newCost)) throw new Error(`${row.sku}: costo ${p.cost} ≠ ${row.newCost}`);
        }
        for (const np of plan.newProducts) {
            const id = keyToId.get(np.key)!;
            const active = await tx.productionRecipe.findMany({ where: { companyId, productId: id, status: 'ACTIVE' }, select: { id: true } });
            if (active.length !== 1) throw new Error(`${np.sku}: ${active.length} BOM ACTIVE`);
            const bomCost = await ProductionRecipeService.computeRecipeCost(active[0].id, companyId, tx);
            const p = await tx.product.findUniqueOrThrow({ where: { id }, select: { cost: true } });
            if (!same(p.cost, bomCost.unitCost, 2e-6)) throw new Error(`${np.sku}: Product.cost ${p.cost} ≠ costo BOM ${bomCost.unitCost}`);
        }
        for (const m of plan.menuItems) {
            const mi = await tx.menuItem.findMany({ where: { companyId, name: m.name }, select: { id: true, brandId: true, _count: { select: { recipes: true } } } });
            if (mi.length !== 1 || mi[0]._count.recipes !== m.lines.length || mi[0].brandId !== d.brandId) throw new Error(`plato ${m.name}: ${mi.length} MenuItem / líneas o marca incorrectas`);
        }
    }, { timeout: Number(process.env.RECON_TX_TIMEOUT_MS || 120000) });
    console.log('Aplicado. Vuelva a ejecutar en dry-run: debe reportar 0 cambios.');
}

main()
    .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
