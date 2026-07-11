import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import prisma from '../utils/prisma';

type Options = { companyId: number | null; out: string | null; help: boolean };

const HELP = `
Backup de solo lectura para recetas de un tenant.

Uso:
  node dist/scripts/backup-recipe-data.js --company-id <id> --out <archivo.json>

Exporta MenuItem/Recipe, ProductionRecipe/componentes y el catálogo operativo
necesario para auditar mapeos (unidades, costos y existencias). No exporta
usuarios, credenciales ni sesiones. El archivo de salida no se sobrescribe.
`;

function readValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
    const token = args[index];
    const equalIndex = token.indexOf('=');
    if (equalIndex >= 0) {
        const value = token.slice(equalIndex + 1).trim();
        if (!value) throw new Error(`${flag} requiere un valor.`);
        return { value, nextIndex: index };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return { value, nextIndex: index + 1 };
}

function parseArgs(args: string[]): Options {
    const options: Options = { companyId: null, out: null, help: false };
    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        const flag = token.split('=')[0];
        if (flag === '--help' || flag === '-h') {
            options.help = true;
        } else if (flag === '--company-id') {
            const read = readValue(args, index, flag);
            const companyId = Number(read.value);
            if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('--company-id debe ser un entero positivo.');
            options.companyId = companyId;
            index = read.nextIndex;
        } else if (flag === '--out') {
            const read = readValue(args, index, flag);
            options.out = path.resolve(read.value);
            index = read.nextIndex;
        } else {
            throw new Error(`Opción desconocida: ${token}`);
        }
    }
    return options;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }
    if (!options.companyId) throw new Error('--company-id es obligatorio; la empresa nunca se infiere.');
    if (!options.out) throw new Error('--out es obligatorio.');
    if (path.extname(options.out).toLowerCase() !== '.json') throw new Error('--out debe terminar en .json.');

    const company = await prisma.company.findFirst({
        where: { id: options.companyId, active: true },
        select: { id: true, name: true }
    });
    if (!company) throw new Error(`No existe una empresa activa con id ${options.companyId}.`);

    const [menuItems, productionRecipes, products, unitsOfMeasure] = await Promise.all([
        prisma.menuItem.findMany({
            where: { companyId: options.companyId },
            select: {
                id: true,
                name: true,
                price: true,
                active: true,
                type: true,
                category: { select: { id: true, name: true } },
                brand: { select: { id: true, name: true } },
                branch: { select: { id: true, code: true, name: true } },
                recipes: {
                    select: {
                        id: true,
                        quantity: true,
                        unit: true,
                        unitId: true,
                        product: { select: { id: true, sku: true, name: true, unit: true } },
                        unitOfMeasure: { select: { id: true, abbreviation: true, name: true } }
                    },
                    orderBy: { id: 'asc' }
                }
            },
            orderBy: { id: 'asc' }
        }),
        prisma.productionRecipe.findMany({
            where: { companyId: options.companyId },
            select: {
                id: true,
                name: true,
                version: true,
                status: true,
                yieldQuantity: true,
                yieldUnitId: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
                product: { select: { id: true, sku: true, name: true, type: true, unit: true } },
                yieldUnit: { select: { id: true, abbreviation: true, name: true } },
                components: {
                    select: {
                        id: true,
                        quantity: true,
                        unit: true,
                        unitId: true,
                        notes: true,
                        componentProduct: { select: { id: true, sku: true, name: true, type: true, unit: true } },
                        unitOfMeasure: { select: { id: true, abbreviation: true, name: true } }
                    },
                    orderBy: { id: 'asc' }
                }
            },
            orderBy: [{ productId: 'asc' }, { version: 'asc' }]
        }),
        prisma.product.findMany({
            where: { companyId: options.companyId },
            select: {
                id: true,
                name: true,
                sku: true,
                type: true,
                unit: true,
                cost: true,
                baseUnitId: true,
                active: true,
                category: { select: { id: true, name: true } },
                currentAverageCost: true,
                lastPurchaseCost: true,
                stocks: {
                    select: { warehouseId: true, quantity: true },
                    orderBy: { warehouseId: 'asc' }
                }
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }]
        }),
        prisma.unitOfMeasure.findMany({
            where: { companyId: options.companyId },
            select: {
                id: true,
                name: true,
                abbreviation: true,
                measurementType: true,
                systemFactor: true,
                active: true
            },
            orderBy: { id: 'asc' }
        })
    ]);

    const backup = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        company,
        counts: {
            menuItems: menuItems.length,
            menuRecipeLines: menuItems.reduce((sum, item) => sum + item.recipes.length, 0),
            productionRecipes: productionRecipes.length,
            productionComponentLines: productionRecipes.reduce((sum, recipe) => sum + recipe.components.length, 0),
            catalogProducts: products.length,
            unitsOfMeasure: unitsOfMeasure.length
        },
        menuItems,
        productionRecipes,
        catalog: { products, unitsOfMeasure }
    };

    await mkdir(path.dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(backup, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ success: true, out: options.out, counts: backup.counts }, null, 2)}\n`);
}

main()
    .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error de backup: ${detail}\n`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
