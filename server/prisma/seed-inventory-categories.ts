/**
 * Crea/actualiza categorías de inventario para todas las empresas.
 * Ejecución: npx ts-node --transpile-only prisma/seed-inventory-categories.ts
 */
import { PrismaClient } from '@prisma/client';
import { CategoryService } from '../src/services/category.service';

const prisma = new PrismaClient();

async function main() {
    const companies = await prisma.company.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
    });

    if (companies.length === 0) {
        console.log('No hay empresas activas.');
        return;
    }

    for (const company of companies) {
        const result = await CategoryService.ensureDefaultCategories(company.id);
        console.log(`\n[${company.name}]`);
        if (result.created.length > 0) {
            console.log(`  Creadas: ${result.created.join(', ')}`);
        }
        if (result.existing.length > 0) {
            console.log(`  Existentes: ${result.existing.join(', ')}`);
        }
    }

    console.log('\nCategorías de inventario listas.');
}

main()
    .catch((error) => {
        console.error('Error al crear categorías:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
