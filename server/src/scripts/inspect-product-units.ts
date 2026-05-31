import prisma from '../utils/prisma';

async function main() {
    const units = await prisma.unitOfMeasure.findMany({
        select: { id: true, abbreviation: true, name: true, measurementType: true, companyId: true }
    });
    console.log('Catalog units:', JSON.stringify(units, null, 2));

    const distribution = await prisma.product.groupBy({
        by: ['unit'],
        _count: true,
        orderBy: { _count: { unit: 'desc' } }
    });
    console.log('Product unit distribution:', JSON.stringify(distribution, null, 2));

    const withoutBase = await prisma.product.count({ where: { baseUnitId: null, active: true } });
    const withBase = await prisma.product.count({ where: { baseUnitId: { not: null }, active: true } });
    console.log(`Products baseUnitId: null=${withoutBase}, set=${withBase}`);
}

main().finally(() => prisma.$disconnect());
