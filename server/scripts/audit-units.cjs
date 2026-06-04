/* eslint-disable */
/**
 * READ-ONLY production audit of units of measure, products, conversions and
 * recipes. Connects using MYSQL_PUBLIC_URL (inject via:
 *   railway run --service MySQL node scripts/audit-units.cjs
 * Performs ONLY SELECT queries. Prints a structured report.
 */
const mysql = require('mysql2/promise');

// ---- replicate UnitConversionService normalization ----
function sanitize(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[.\s_-]+/g, '');
}
const ALIAS = {
  gl: 'gal', galon: 'gal', galones: 'gal', lt: 'l', ltr: 'l', lts: 'l', liter: 'l',
  litro: 'l', litros: 'l', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g', grams: 'g',
  kilo: 'kg', kilos: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilogramo: 'kg',
  kilogramos: 'kg', lbs: 'lb', libra: 'lb', libras: 'lb', onza: 'oz', onzas: 'oz',
  ml: 'ml', millilitro: 'ml', millilitros: 'ml', mililitro: 'ml', mililitros: 'ml',
  und: 'unidad', unid: 'unidad', u: 'unidad', unds: 'unidad', paq: 'paquete',
  paqte: 'paquete', pkg: 'paquete', pqt: 'paquete', pq: 'paquete', pk: 'paquete',
  cja: 'caja', sac: 'saco', doc: 'docena',
};
function normalize(raw) {
  const a = sanitize(raw);
  return ALIAS[a] || a;
}
function candidates(legacyUnit) {
  const raw = String(legacyUnit || '').trim().toLowerCase();
  if (!raw) return [];
  const s = sanitize(raw);
  const n = normalize(raw);
  const rnd = raw.replace(/[.\s_-]+/g, '');
  return [...new Set([n, s, rnd, raw].filter(Boolean))];
}

async function main() {
  const url = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No MYSQL_PUBLIC_URL/DATABASE_URL'); process.exit(1); }
  const conn = await mysql.createConnection(url);
  const q = async (sql) => (await conn.query(sql))[0];

  const companies = await q('SELECT id, name FROM `Company`');
  const units = await q('SELECT id, companyId, name, abbreviation, measurementType, CAST(systemFactor AS CHAR) systemFactor, active FROM `UnitOfMeasure`');
  const products = await q('SELECT id, companyId, name, unit, baseUnitId, active FROM `Product`');
  const productUnits = await q('SELECT id, companyId, productId, unitId, CAST(conversionFactor AS CHAR) conversionFactor, isDefault, active FROM `ProductUnit`');
  const recipes = await q('SELECT r.id, r.menuItemId, r.productId, CAST(r.quantity AS CHAR) quantity, r.unit, r.unitId, mi.name menuItemName, mi.companyId FROM `Recipe` r JOIN `MenuItem` mi ON mi.id = r.menuItemId');
  const stocks = await q('SELECT s.id, s.companyId, s.warehouseId, s.productId, CAST(s.quantity AS CHAR) quantity FROM `Stock` s');

  // index helpers
  const unitById = new Map(units.map(u => [u.id, u]));
  const unitsByCompany = new Map();
  for (const u of units) {
    if (!unitsByCompany.has(u.companyId)) unitsByCompany.set(u.companyId, new Map());
    unitsByCompany.get(u.companyId).set(String(u.abbreviation).toLowerCase(), u);
  }
  const productById = new Map(products.map(p => [p.id, p]));
  const puByProduct = new Map();
  for (const pu of productUnits) {
    if (!puByProduct.has(pu.productId)) puByProduct.set(pu.productId, []);
    puByProduct.get(pu.productId).push(pu);
  }

  function findCompanyUnitExact(companyId, abbr) {
    const m = unitsByCompany.get(companyId);
    if (!m) return null;
    return m.get(String(abbr).toLowerCase()) || null;
  }
  // resolve base unit from legacy (exact candidates, then startsWith/name)
  function resolveBaseFromLegacy(companyId, legacyUnit) {
    const cands = candidates(legacyUnit);
    for (const ab of cands) {
      const u = findCompanyUnitExact(companyId, ab);
      if (u && u.active) return u;
    }
    const m = unitsByCompany.get(companyId);
    if (m) {
      for (const ab of cands) {
        for (const u of m.values()) {
          if (!u.active) continue;
          if (String(u.abbreviation).toLowerCase().startsWith(ab) || String(u.name).toLowerCase() === ab) return u;
        }
      }
    }
    return null;
  }

  // Replicate convert() resolvability. Returns { ok, mode, reason }
  function canConvert(product, requestedUnitRaw) {
    const baseUnit = product.baseUnitId ? unitById.get(product.baseUnitId) : null;
    const reqAbbr = normalize(requestedUnitRaw);
    if (!baseUnit) {
      const inferred = resolveBaseFromLegacy(product.companyId, product.unit);
      if (!inferred) return { ok: true, mode: 'legacy-1:1' };
      if (reqAbbr === String(inferred.abbreviation).toLowerCase()) return { ok: true, mode: 'inferred-base' };
      const dyn = findCompanyUnitExact(product.companyId, reqAbbr);
      if (!dyn || !dyn.active || dyn.measurementType !== inferred.measurementType) {
        return { ok: false, reason: `unidad "${requestedUnitRaw}" incompatible con base inferida "${inferred.abbreviation}" (${inferred.measurementType})` };
      }
      return { ok: true, mode: 'inferred-dynamic' };
    }
    if (reqAbbr === String(baseUnit.abbreviation).toLowerCase()) return { ok: true, mode: 'base' };
    const pus = (puByProduct.get(product.id) || []).filter(p => p.active);
    const matched = pus.find(p => {
      const u = unitById.get(p.unitId);
      return u && String(u.abbreviation).toLowerCase() === reqAbbr;
    });
    if (matched) return { ok: true, mode: 'productUnit', factor: Number(matched.conversionFactor) };
    const dyn = findCompanyUnitExact(product.companyId, reqAbbr);
    if (!dyn || !dyn.active) return { ok: false, reason: `unidad "${requestedUnitRaw}" no permitida y no existe en catálogo` };
    if (dyn.measurementType !== baseUnit.measurementType) {
      return { ok: false, reason: `unidad "${requestedUnitRaw}" (${dyn.measurementType}) incompatible con base "${baseUnit.abbreviation}" (${baseUnit.measurementType})` };
    }
    return { ok: true, mode: 'dynamic' };
  }

  const R = {
    companies: companies.length,
    units: units.length,
    products: products.length,
    productUnits: productUnits.length,
    recipes: recipes.length,
  };

  // --- A. Catalog issues ---
  const catalogByCompany = {};
  for (const c of companies) {
    const m = unitsByCompany.get(c.id);
    catalogByCompany[c.id] = { name: c.name, count: m ? m.size : 0, units: m ? [...m.values()].map(u => `${u.abbreviation}[${u.measurementType} sf=${u.systemFactor}${u.active ? '' : ' INACTIVE'}]`) : [] };
  }
  const unitsBadSystemFactor = units.filter(u => !(Number(u.systemFactor) > 0));

  // --- B. Products ---
  const activeProducts = products.filter(p => p.active);
  const prodNoBase = activeProducts.filter(p => !p.baseUnitId);
  const prodDrift = activeProducts.filter(p => {
    if (!p.baseUnitId) return false;
    const b = unitById.get(p.baseUnitId);
    return b && normalize(p.unit) !== String(b.abbreviation).toLowerCase();
  });
  const prodLegacyNotInCatalog = activeProducts.filter(p => {
    if (p.baseUnitId) return false;
    return !resolveBaseFromLegacy(p.companyId, p.unit);
  });

  // --- C. ProductUnit ---
  const prodNoAllowed = activeProducts.filter(p => p.baseUnitId && !(puByProduct.get(p.id) || []).some(x => x.active));
  const prodNoDefault = activeProducts.filter(p => p.baseUnitId && (puByProduct.get(p.id) || []).some(x => x.active) && !(puByProduct.get(p.id) || []).some(x => x.active && x.isDefault));
  const puBadFactor = productUnits.filter(pu => pu.active && !(Number(pu.conversionFactor) > 0));
  const puPackageFactorOne = productUnits.filter(pu => {
    if (!pu.active) return false;
    const u = unitById.get(pu.unitId);
    const p = productById.get(pu.productId);
    if (!u || !p) return false;
    const isBase = p.baseUnitId === pu.unitId;
    return u.measurementType === 'PACKAGE' && !isBase && Number(pu.conversionFactor) === 1;
  });

  // --- D. Recipes (CRITICAL) ---
  const recipeFail = [];
  const recipeUnitIdFixable = [];
  for (const r of recipes) {
    const p = productById.get(r.productId);
    if (!p) { recipeFail.push({ ...r, reason: 'producto inexistente' }); continue; }
    const reqUnit = r.unit || p.unit;
    const res = canConvert(p, reqUnit);
    if (!res.ok) recipeFail.push({ id: r.id, menuItemName: r.menuItemName, product: p.name, unit: r.unit, productUnit: p.unit, reason: res.reason });
    // fixable unitId: unit set, resolvable to an exact catalog unit, unitId null or mismatched
    if (r.unit) {
      const cu = findCompanyUnitExact(r.companyId, normalize(r.unit));
      if (cu && r.unitId !== cu.id) recipeUnitIdFixable.push({ id: r.id, menuItemName: r.menuItemName, unit: r.unit, currentUnitId: r.unitId, shouldBe: cu.id });
    }
  }

  // --- E. Stock ---
  const negativeStock = stocks.filter(s => Number(s.quantity) < 0);

  // ---- print ----
  const log = (...a) => console.log(...a);
  log('\n==================== AUDIT UNIDADES (PRODUCCIÓN) ====================');
  log('Totales:', JSON.stringify(R));
  log('\n--- A. CATÁLOGO DE UNIDADES POR EMPRESA ---');
  for (const [cid, info] of Object.entries(catalogByCompany)) {
    log(`Empresa ${cid} (${info.name}): ${info.count} unidades`);
    log('   ', info.units.join(', ') || '(SIN UNIDADES)');
  }
  if (unitsBadSystemFactor.length) {
    log('\n[!] Unidades con systemFactor <= 0:', unitsBadSystemFactor.map(u => `${u.id}:${u.abbreviation}=${u.systemFactor}`).join(', '));
  }

  log('\n--- B. PRODUCTOS ---');
  log(`Activos: ${activeProducts.length}`);
  log(`[!] Sin baseUnitId (no configurados): ${prodNoBase.length}`);
  prodNoBase.slice(0, 50).forEach(p => log(`    #${p.id} ${p.name} (unit="${p.unit}", company=${p.companyId})`));
  if (prodNoBase.length > 50) log(`    ... y ${prodNoBase.length - 50} más`);
  log(`[!] Legacy unit no resoluble en catálogo: ${prodLegacyNotInCatalog.length}`);
  prodLegacyNotInCatalog.slice(0, 50).forEach(p => log(`    #${p.id} ${p.name} (unit="${p.unit}")`));
  log(`[~] Drift unit<>baseUnit.abbr: ${prodDrift.length}`);
  prodDrift.slice(0, 50).forEach(p => { const b = unitById.get(p.baseUnitId); log(`    #${p.id} ${p.name}: unit="${p.unit}" base="${b ? b.abbreviation : '?'}"`); });

  log('\n--- C. CONVERSIONES (ProductUnit) ---');
  log(`[!] Productos con base pero SIN unidades permitidas: ${prodNoAllowed.length}`);
  prodNoAllowed.slice(0, 50).forEach(p => log(`    #${p.id} ${p.name}`));
  log(`[~] Productos con base sin unidad isDefault: ${prodNoDefault.length}`);
  prodNoDefault.slice(0, 50).forEach(p => log(`    #${p.id} ${p.name}`));
  log(`[!] ProductUnit con conversionFactor <= 0: ${puBadFactor.length}`);
  puBadFactor.slice(0, 50).forEach(pu => { const p = productById.get(pu.productId); const u = unitById.get(pu.unitId); log(`    pu#${pu.id} prod=${p ? p.name : pu.productId} unit=${u ? u.abbreviation : pu.unitId} factor=${pu.conversionFactor}`); });
  log(`[~] Empaque (PACKAGE) con factor=1 (sospechoso, no configurado): ${puPackageFactorOne.length}`);
  puPackageFactorOne.slice(0, 80).forEach(pu => { const p = productById.get(pu.productId); const u = unitById.get(pu.unitId); log(`    prod #${p ? p.id : pu.productId} ${p ? p.name : ''} -> ${u ? u.abbreviation : pu.unitId} = 1 (1 ${u ? u.abbreviation : ''} = 1 base?)`); });

  log('\n--- D. RECETAS (CRÍTICO PARA VENTAS) ---');
  log(`Total recetas: ${recipes.length}`);
  log(`[X] Recetas que FALLARÍAN la conversión (bloquean venta): ${recipeFail.length}`);
  recipeFail.slice(0, 100).forEach(r => log(`    recipe#${r.id} "${r.menuItemName}" ing="${r.product}" recipeUnit="${r.unit || ''}" prodUnit="${r.productUnit || ''}" -> ${r.reason}`));
  log(`[~] Recetas con unitId desincronizado (fixable): ${recipeUnitIdFixable.length}`);

  log('\n--- E. STOCK ---');
  log(`[!] Stock negativo: ${negativeStock.length}`);
  negativeStock.slice(0, 50).forEach(s => { const p = productById.get(s.productId); log(`    stock#${s.id} prod=${p ? p.name : s.productId} wh=${s.warehouseId} qty=${s.quantity}`); });

  log('\n==================== FIN AUDIT ====================\n');

  await conn.end();
}
main().catch(e => { console.error('AUDIT ERROR:', e); process.exit(1); });
