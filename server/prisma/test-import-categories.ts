import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { ProductImportService } from '../src/services/product-import.service';

const prisma = new PrismaClient();
const companyId = 1;
const filePath = 'c:\\restaurant\\Plantilla_Productos 20.05.26 - importacion.xlsx';

async function main() {
    const inventoryCategories = [
        'Congelados',
        'Empaques',
        'Limpieza',
        'Misceláneo',
        'Vegetales',
        'Carnes',
        'Lácteos',
    ];

    for (const name of inventoryCategories) {
        const category = await prisma.category.findFirst({
            where: { companyId, name },
        });
        if (category) {
            await prisma.category.delete({ where: { id: category.id } });
            console.log('deleted', name);
        }
    }

    const remaining = await prisma.category.findMany({
        where: { companyId, active: true },
        select: { name: true },
        orderBy: { name: 'asc' },
    });
    console.log('remaining categories:', remaining.map((c) => c.name).join(', '));

    const buffer = fs.readFileSync(filePath);
    const result = await ProductImportService.validateExcel(buffer, companyId);
    console.log('summary', result.summary);
    console.log('first invalid', result.items.find((item) => !item.isValid));

    const after = await prisma.category.findMany({
        where: { companyId, active: true },
        select: { name: true },
        orderBy: { name: 'asc' },
    });
    console.log('categories after validate:', after.map((c) => c.name).join(', '));
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => prisma.$disconnect());
