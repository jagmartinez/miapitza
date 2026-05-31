import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            username: true,
            companyId: true,
            company: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
    });

    for (const user of users) {
        const count = await prisma.category.count({
            where: { companyId: user.companyId, active: true },
        });
        console.log(`User ${user.username} -> company ${user.companyId} (${user.company.name}), categories: ${count}`);
    }
}

main()
    .finally(async () => prisma.$disconnect());
