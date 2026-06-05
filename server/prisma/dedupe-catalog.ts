/**
 * Elimina duplicados de productos y categorías por nombre normalizado.
 * Uso: npx tsx prisma/dedupe-catalog.ts [--dry-run]
 */

import prisma from '../src/utils/prisma';
import {
  mergeCategoryRecords,
  mergeProductRecords,
  normalizeCategoryKey,
  normalizeProductKey,
  productSurvivorScore,
} from './catalog-merge-utils';

const COMPANY_ID = 1;
const DRY_RUN = process.argv.includes('--dry-run');

async function dedupeProducts() {
  const products = await prisma.product.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, name: true, sku: true, categoryId: true },
    orderBy: { id: 'asc' },
  });

  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const key = normalizeProductKey(p.name);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  let merged = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const scored = await Promise.all(
      group.map(async (p) => ({ p, score: await productSurvivorScore(prisma, p.id) }))
    );
    scored.sort((a, b) => b.score - a.score);
    const survivor = scored[0].p;
    const losers = scored.slice(1).map((s) => s.p);

    console.log(`Producto "${key}" → conservar #${survivor.id} ${survivor.sku} ${survivor.name}`);
    for (const loser of losers) {
      console.log(`  fusionar #${loser.id} ${loser.sku} ${loser.name}`);
      if (!DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          await mergeProductRecords(tx, COMPANY_ID, survivor.id, loser.id);
        }, { maxWait: 30_000, timeout: 120_000 });
      }
      merged++;
    }
  }
  return merged;
}

async function dedupeCategories() {
  const categories = await prisma.category.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, name: true, codePrefix: true },
    orderBy: { id: 'asc' },
  });

  const groups = new Map<string, typeof categories>();
  for (const c of categories) {
    const key = normalizeCategoryKey(c.name);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  let merged = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const withCounts = await Promise.all(
      group.map(async (c) => {
        const [products, menuItems] = await Promise.all([
          prisma.product.count({ where: { categoryId: c.id } }),
          prisma.menuItem.count({ where: { categoryId: c.id } }),
        ]);
        return { c, score: products + menuItems * 5 };
      })
    );
    withCounts.sort((a, b) => b.score - a.score);
    const survivor = withCounts[0].c;
    const losers = withCounts.slice(1).map((s) => s.c);

    console.log(`Categoría "${key}" → conservar #${survivor.id} ${survivor.name} (${survivor.codePrefix})`);
    for (const loser of losers) {
      console.log(`  fusionar #${loser.id} ${loser.name} (${loser.codePrefix})`);
      if (!DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          await mergeCategoryRecords(tx, survivor.id, loser.id);
        }, { maxWait: 30_000, timeout: 60_000 });
      }
      merged++;
    }
  }
  return merged;
}

async function main() {
  console.log(`=== Dedupe catálogo companyId=${COMPANY_ID}${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`);

  console.log('→ Categorías duplicadas…');
  const catMerged = await dedupeCategories();
  console.log(`  ${catMerged} categorías fusionadas\n`);

  console.log('→ Productos duplicados…');
  const prodMerged = await dedupeProducts();
  console.log(`  ${prodMerged} productos fusionados\n`);

  const [categories, products] = await Promise.all([
    prisma.category.count({ where: { companyId: COMPANY_ID } }),
    prisma.product.count({ where: { companyId: COMPANY_ID } }),
  ]);
  console.log(`Totales: ${categories} categorías, ${products} productos`);
  if (DRY_RUN) console.log('\n(dry-run: no se escribió nada en la BD)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
