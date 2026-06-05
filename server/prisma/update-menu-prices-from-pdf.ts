/**
 * Actualiza precios de MenuItem usando "La Mia Pitza Menu 2.pdf".
 *
 * Uso: npx tsx prisma/update-menu-prices-from-pdf.ts
 */

import prisma from '../src/utils/prisma';
import { resolveMenuPrice, RECIPE_CODE_PRICES } from './miapitz-menu-prices';

async function main() {
  const company = await prisma.company.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  if (!company) throw new Error('No hay empresa activa');

  const items = await prisma.menuItem.findMany({
    where: { companyId: company.id, active: true },
    select: { id: true, name: true, price: true, description: true, category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  let updated = 0;
  const unmatched: string[] = [];

  for (const item of items) {
    const newPrice = resolveMenuPrice(item.name, item.description);
    if (newPrice == null) {
      unmatched.push(item.name);
      continue;
    }

    const current = Number(item.price);
    if (current === newPrice) continue;

    await prisma.menuItem.update({
      where: { id: item.id },
      data: {
        price: newPrice,
        description: (item.description ?? '')
          .replace(' | [IMPORTADO - ASIGNAR PRECIO]', '')
          .replace('[IMPORTADO - ASIGNAR PRECIO]', '')
          .trim() || undefined,
      },
    });

    console.log(`  ${item.name}: ${current} → ${newPrice}`);
    updated++;
  }

  console.log('\n=== Resumen precios PDF ===');
  console.log(`  Platos en BD:        ${items.length}`);
  console.log(`  Precios actualizados:${updated}`);
  console.log(`  Sin match en PDF:    ${unmatched.length}`);
  if (unmatched.length) {
    for (const name of unmatched) console.log(`    - ${name}`);
  }
  console.log(`  Códigos PZ en PDF:   ${Object.keys(RECIPE_CODE_PRICES).length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
