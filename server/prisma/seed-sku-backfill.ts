/**
 * Backfill script: assigns SKU codes to existing products that don't have one.
 * Uses the category's codePrefix (or 'GEN' if none) + sequential numbering.
 *
 * Usage: npx ts-node prisma/seed-sku-backfill.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillSkus() {
    const productsWithoutSku = await prisma.product.findMany({
        where: {
            OR: [
                { sku: null },
                { sku: '' },
            ],
        },
        include: {
            category: { select: { id: true, codePrefix: true } },
            company: { select: { id: true, name: true } },
        },
        orderBy: [{ companyId: 'asc' }, { categoryId: 'asc' }, { id: 'asc' }],
    });

    if (productsWithoutSku.length === 0) {
        console.log('✓ All products already have SKU codes assigned.');
        return;
    }

    console.log(`Found ${productsWithoutSku.length} products without SKU. Assigning...`);

    let updated = 0;
    const prefixCounters: Record<string, number> = {};

    for (const product of productsWithoutSku) {
        const prefix = product.category?.codePrefix || 'GEN';
        const cacheKey = `${product.companyId}:${prefix}`;

        if (!(cacheKey in prefixCounters)) {
            const lastProduct = await prisma.product.findFirst({
                where: {
                    companyId: product.companyId,
                    sku: { startsWith: `${prefix}-` },
                },
                orderBy: { sku: 'desc' },
                select: { sku: true },
            });

            let lastNum = 0;
            if (lastProduct?.sku) {
                const parts = lastProduct.sku.split('-');
                const num = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(num)) lastNum = num;
            }
            prefixCounters[cacheKey] = lastNum;
        }

        prefixCounters[cacheKey]++;
        const newSku = `${prefix}-${String(prefixCounters[cacheKey]).padStart(6, '0')}`;

        await prisma.product.update({
            where: { id: product.id },
            data: { sku: newSku },
        });

        console.log(`  [${product.company.name}] ${product.name} → ${newSku}`);
        updated++;
    }

    console.log(`\n✓ Done. ${updated} products updated with SKU codes.`);
}

backfillSkus()
    .catch((e) => {
        console.error('Error during SKU backfill:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
