import { PrismaClient } from '@prisma/client';

function normalizeCode(value: string) {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
}

async function getNextCentralCode(prisma: PrismaClient, companyId: number) {
    const baseCode = normalizeCode('CENTRAL');
    let candidate = baseCode;
    let suffix = 2;

    while (await prisma.warehouse.findFirst({ where: { companyId, code: candidate } })) {
        candidate = normalizeCode(`${baseCode}-${suffix}`);
        suffix += 1;
    }

    return candidate;
}

export async function bootstrapCentralWarehouses(prisma: PrismaClient) {
    const companies = await prisma.company.findMany({
        select: {
            id: true,
            name: true
        },
        orderBy: {
            id: 'asc'
        }
    });

    const results: Array<{
        companyId: number;
        companyName: string;
        action: 'created' | 'existing';
        warehouseId: number;
        code: string;
    }> = [];

    for (const company of companies) {
        const existingCentral = await prisma.warehouse.findFirst({
            where: {
                companyId: company.id,
                type: 'CENTRAL'
            },
            orderBy: {
                id: 'asc'
            }
        });

        if (existingCentral) {
            results.push({
                companyId: company.id,
                companyName: company.name,
                action: 'existing',
                warehouseId: existingCentral.id,
                code: existingCentral.code
            });
            continue;
        }

        const code = await getNextCentralCode(prisma, company.id);
        const warehouse = await prisma.warehouse.create({
            data: {
                companyId: company.id,
                branchId: null,
                type: 'CENTRAL',
                name: 'Bodega Central',
                code
            }
        });

        results.push({
            companyId: company.id,
            companyName: company.name,
            action: 'created',
            warehouseId: warehouse.id,
            code: warehouse.code
        });
    }

    return results;
}

async function main() {
    const prisma = new PrismaClient();

    try {
        console.log('Bootstrapping central warehouses...');
        const results = await bootstrapCentralWarehouses(prisma);

        for (const result of results) {
            console.log(
                `[${result.action.toUpperCase()}] company=${result.companyName} warehouseId=${result.warehouseId} code=${result.code}`
            );
        }

        console.log(`Done. Companies scanned: ${results.length}`);
    } catch (error) {
        console.error('Error bootstrapping central warehouses:', error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    void main();
}
