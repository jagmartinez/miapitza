import prisma from '../src/utils/prisma';

async function main() {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      role: { name: { in: ['ADMIN', 'SUPERADMIN'] } },
    },
    select: { id: true, companyId: true, username: true, role: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  console.log(JSON.stringify(users));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
