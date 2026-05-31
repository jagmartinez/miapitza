import prisma from '../utils/prisma';
import { UnitConversionService } from '../services/unit-conversion.service';

const LEGACY_UNIT_MAP: Record<string, string> = {
    gl: 'gal',
    galon: 'gal',
    galones: 'gal',
    lt: 'l',
    ltr: 'l',
    lts: 'l',
    liter: 'l',
    litro: 'l',
    litros: 'l',
    gr: 'g',
    grs: 'g',
    gramo: 'g',
    gramos: 'g',
    grams: 'g',
    kilo: 'kg',
    kilos: 'kg',
    kgs: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    kilogramo: 'kg',
    kilogramos: 'kg',
    lbs: 'lb',
    libra: 'lb',
    libras: 'lb',
    onza: 'oz',
    onzas: 'oz',
    ml: 'ml',
    millilitro: 'ml',
    millilitros: 'ml',
    mililitro: 'ml',
    mililitros: 'ml',
    und: 'unidad',
    unid: 'unidad',
    u: 'unidad',
    unds: 'unidad',
    doc: 'docena',
    paq: 'paquete',
    paqte: 'paquete',
    pkg: 'paquete',
    pqt: 'paquete',
    pq: 'paquete',
    pk: 'paquete',
    cja: 'caja',
    sac: 'saco',
};

function sanitizeUnit(raw: string): string {
    return String(raw || '').trim().toLowerCase().replace(/[.\s_-]+/g, '');
}

function normalizeProductUnit(raw: string): string {
    const sanitized = sanitizeUnit(raw);
    return LEGACY_UNIT_MAP[sanitized] || sanitized;
}

async function catalogHasUnit(companyId: number, abbreviation: string): Promise<boolean> {
    const unit = await prisma.unitOfMeasure.findUnique({
        where: { companyId_abbreviation: { companyId, abbreviation } }
    });
    return Boolean(unit?.active);
}

async function resolveCatalogUnit(companyId: number, legacyUnit: string): Promise<string | null> {
    const normalized = normalizeProductUnit(legacyUnit);
    if (await catalogHasUnit(companyId, normalized)) {
        return normalized;
    }

    // Accept legacy catalog abbreviations already stored in UnitOfMeasure
    const legacyCatalogFallback: Record<string, string> = {
        g: 'gr',
        l: 'lt',
        gal: 'gl',
        docena: 'doc',
    };
    const fallback = legacyCatalogFallback[normalized];
    if (fallback && await catalogHasUnit(companyId, fallback)) {
        return normalized;
    }

    return null;
}

async function fixProductUnits() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(dryRun ? 'DRY RUN — no changes will be saved' : 'LIVE RUN — updating production data');

    const companies = await prisma.company.findMany({
        where: { active: true },
        select: { id: true, name: true }
    });

    let normalizedUnits = 0;
    let configuredProducts = 0;
    let skippedProducts = 0;
    const skippedSamples: string[] = [];

    for (const company of companies) {
        console.log(`\n=== ${company.name} (ID ${company.id}) ===`);

        const beforeCount = await prisma.unitOfMeasure.count({ where: { companyId: company.id, active: true } });
        if (!dryRun) {
            await UnitConversionService.seedDefaultUnits(company.id);
        }
        const afterCount = dryRun ? beforeCount : await prisma.unitOfMeasure.count({ where: { companyId: company.id, active: true } });
        console.log(`Units in catalog: ${beforeCount} -> ${afterCount}`);

        const products = await prisma.product.findMany({
            where: { companyId: company.id, active: true },
            select: { id: true, name: true, unit: true, baseUnitId: true, sku: true },
            orderBy: { id: 'asc' }
        });
        console.log(`Active products: ${products.length}`);

        for (const product of products) {
            const canonical = await resolveCatalogUnit(company.id, product.unit);
            const nextUnit = canonical || normalizeProductUnit(product.unit);

            if (canonical && nextUnit !== product.unit) {
                if (!dryRun) {
                    await prisma.product.update({
                        where: { id: product.id },
                        data: { unit: nextUnit }
                    });
                }
                normalizedUnits++;
            } else if (!canonical) {
                skippedProducts++;
                if (skippedSamples.length < 15) {
                    skippedSamples.push(`${product.sku || product.id}: "${product.unit}"`);
                }
            }

            const effectiveUnit = canonical ? nextUnit : product.unit;

            if (!dryRun && product.baseUnitId) {
                const allowedCount = await prisma.productUnit.count({
                    where: { productId: product.id, companyId: company.id, active: true }
                });
                if (allowedCount > 1) {
                    configuredProducts++;
                    continue;
                }
            }

            if (!dryRun) {
                const result = await UnitConversionService.autoConfigureProduct(
                    product.id,
                    company.id,
                    effectiveUnit
                );
                if (result) configuredProducts++;
            } else if (canonical || await resolveCatalogUnit(company.id, effectiveUnit)) {
                configuredProducts++;
            }

            if ((configuredProducts + skippedProducts) % 25 === 0) {
                console.log(`  progress: ${configuredProducts + skippedProducts}/${products.length}`);
            }
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Product units normalized: ${normalizedUnits}`);
    console.log(`Products auto-configured: ${configuredProducts}`);
    console.log(`Products skipped (unknown unit): ${skippedProducts}`);
    if (skippedSamples.length > 0) {
        console.log('Skipped samples:', skippedSamples.join('; '));
    }
    console.log(dryRun ? '\nRe-run without --dry-run to apply changes.' : '\nDone.');
}

fixProductUnits()
    .catch((error) => {
        console.error('Fix failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
