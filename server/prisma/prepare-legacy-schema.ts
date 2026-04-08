import { PrismaClient } from '@prisma/client';

type ColumnInfo = {
    Field: string;
    Type: string;
    Null: 'YES' | 'NO';
    Key: string;
    Default: string | null;
    Extra: string;
};

function normalizeCode(value: string) {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
}

async function hasColumn(prisma: PrismaClient, tableName: string, columnName: string) {
    const columns = await prisma.$queryRawUnsafe<ColumnInfo[]>(`SHOW COLUMNS FROM \`${tableName}\``);
    return columns.some(column => column.Field === columnName);
}

async function getUniqueWarehouseCode(
    prisma: PrismaClient,
    companyId: number,
    baseValue: string,
    currentWarehouseId: number
) {
    let candidate = normalizeCode(baseValue) || `WAREHOUSE-${currentWarehouseId}`;
    let suffix = 2;

    while (
        await prisma.$queryRawUnsafe<Array<{ id: number }>>(
            'SELECT id FROM Warehouse WHERE companyId = ? AND code = ? AND id <> ? LIMIT 1',
            companyId,
            candidate,
            currentWarehouseId
        ).then(rows => rows.length > 0)
    ) {
        candidate = normalizeCode(`${baseValue}-${suffix}`) || `WAREHOUSE-${currentWarehouseId}-${suffix}`;
        suffix += 1;
    }

    return candidate;
}

async function main() {
    const prisma = new PrismaClient();

    try {
        console.log('Preparing legacy schema for Prisma db push...');

        const warehouseHasCode = await hasColumn(prisma, 'Warehouse', 'code');
        if (!warehouseHasCode) {
            console.log('Adding Warehouse.code as nullable for backfill...');
            await prisma.$executeRawUnsafe('ALTER TABLE `Warehouse` ADD COLUMN `code` VARCHAR(191) NULL');
        }

        const warehouseHasType = await hasColumn(prisma, 'Warehouse', 'type');
        if (!warehouseHasType) {
            console.log('Adding Warehouse.type with BRANCH default...');
            await prisma.$executeRawUnsafe(
                "ALTER TABLE `Warehouse` ADD COLUMN `type` ENUM('CENTRAL','BRANCH') NOT NULL DEFAULT 'BRANCH'"
            );
        }

        const transferHasGroup = await hasColumn(prisma, 'InventoryMovement', 'transferGroupId');
        if (!transferHasGroup) {
            console.log('Adding InventoryMovement.transferGroupId...');
            await prisma.$executeRawUnsafe(
                'ALTER TABLE `InventoryMovement` ADD COLUMN `transferGroupId` VARCHAR(191) NULL'
            );
        }

        const warehouseColumns = await prisma.$queryRawUnsafe<ColumnInfo[]>('SHOW COLUMNS FROM `Warehouse`');
        const branchIdColumn = warehouseColumns.find(column => column.Field === 'branchId');
        if (branchIdColumn?.Null === 'NO') {
            console.log('Making Warehouse.branchId nullable...');
            await prisma.$executeRawUnsafe('ALTER TABLE `Warehouse` MODIFY `branchId` INT NULL');
        }

        const orderColumns = await prisma.$queryRawUnsafe<ColumnInfo[]>('SHOW COLUMNS FROM `Order`');
        const statusColumn = orderColumns.find(column => column.Field === 'status');
        if (statusColumn && !statusColumn.Type.includes('IN_PREPARATION')) {
            console.log('Extending Order.status enum with IN_PREPARATION...');
            await prisma.$executeRawUnsafe(
                "ALTER TABLE `Order` MODIFY `status` ENUM('OPEN','SENT_TO_KITCHEN','IN_PREPARATION','READY','PAID','CANCELLED','DELIVERED') NOT NULL DEFAULT 'OPEN'"
            );
        }

        const warehouses = await prisma.$queryRawUnsafe<Array<{
            id: number;
            companyId: number;
            branchId: number | null;
            name: string;
            code: string | null;
        }>>('SELECT id, companyId, branchId, name, code FROM Warehouse ORDER BY id');

        for (const warehouse of warehouses) {
            if (warehouse.code) {
                continue;
            }

            const branchRows = warehouse.branchId
                ? await prisma.$queryRawUnsafe<Array<{ code: string | null }>>(
                    'SELECT code FROM Branch WHERE id = ? LIMIT 1',
                    warehouse.branchId
                )
                : [];
            const branchCode = branchRows[0]?.code || 'WH';
            const baseCode = `${branchCode}-${warehouse.name}`;
            const nextCode = await getUniqueWarehouseCode(prisma, warehouse.companyId, baseCode, warehouse.id);

            console.log(`Backfilling Warehouse.code for row ${warehouse.id} -> ${nextCode}`);
            await prisma.$executeRawUnsafe('UPDATE Warehouse SET code = ? WHERE id = ?', nextCode, warehouse.id);
        }

        console.log('Enforcing Warehouse.code as NOT NULL...');
        await prisma.$executeRawUnsafe('ALTER TABLE `Warehouse` MODIFY `code` VARCHAR(191) NOT NULL');

        console.log('Legacy schema prepared successfully.');
    } catch (error) {
        console.error('Error preparing legacy schema:', error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    void main();
}
