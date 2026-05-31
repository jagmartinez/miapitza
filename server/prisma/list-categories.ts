import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const companies = await prisma.company.findMany({
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
    });

    for (const company of companies) {
        const categories = await prisma.category.findMany({
            where: { companyId: company.id, active: true },
            select: { name: true, codePrefix: true },
            orderBy: { name: 'asc' },
        });
        console.log(`Company ${company.id} (${company.name}):`);
        for (const category of categories) {
            console.log(`  - ${category.name} [${category.codePrefix || '-'}]`);
        }
    }
}

main()
    .finally(async () => prisma.$disconnect());
