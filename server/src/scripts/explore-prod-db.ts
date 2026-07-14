import prisma from '../utils/prisma';

async function main() {
    const company = await prisma.company.findFirst({
        select: { id: true, name: true, costingMethod: true }
    });
    if (!company) throw new Error('No company');

    const warehouses = await prisma.warehouse.findMany({
        where: { companyId: company.id },
        select: { id: true, name: true, branchId: true }
    });
    const user = await prisma.user.findFirst({
        where: { companyId: company.id, status: 'ACTIVE' },
        select: { id: true, name: true, email: true }
    });
    const supplier = await prisma.supplier.findFirst({
        where: { companyId: company.id },
        select: { id: true, name: true }
    });
    const menuCat = await prisma.category.findFirst({
        where: { companyId: company.id, showInMenu: true },
        select: { id: true, name: true }
    });

    const keywords = ['HARINA', 'TOMATE', 'MASA', 'SALSA', 'MOZZARELLA', 'ACEITE', 'AZUCAR', 'LEVADURA', 'AGUA'];
    const products: Record<string, unknown[]> = {};
    for (const kw of keywords) {
        products[kw] = await prisma.product.findMany({
            where: { companyId: company.id, active: true, name: { contains: kw } },
            take: 5,
            select: { id: true, name: true, sku: true, type: true, unit: true, baseUnitId: true, cost: true, currentAverageCost: true }
        });
    }

    const units = await prisma.unitOfMeasure.findMany({
        where: { companyId: company.id, active: true },
        select: { id: true, abbreviation: true, name: true, measurementType: true }
    });

    console.log(JSON.stringify({ company, warehouses, user, supplier, menuCat, units, products }, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
