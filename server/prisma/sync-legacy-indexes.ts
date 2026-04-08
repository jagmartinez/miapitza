import { PrismaClient } from '@prisma/client';

const INDEX_RENAMES = [
    ['Warehouse', 'Warehouse_companyId_idx', null, ['companyId']],
    ['CashCount', 'CashCount_shiftId_idx', 'CashCount_shiftId_fkey', ['shiftId']],
    ['CashMovement', 'CashMovement_shiftId_idx', 'CashMovement_shiftId_fkey', ['shiftId']],
    ['CashRegister', 'CashRegister_branchId_idx', 'CashRegister_branchId_fkey', ['branchId']],
    ['CashRegister', 'CashRegister_companyId_idx', 'CashRegister_companyId_fkey', ['companyId']],
    ['CashShift', 'CashShift_cashRegisterId_idx', 'CashShift_cashRegisterId_fkey', ['cashRegisterId']],
    ['CashShift', 'CashShift_userId_idx', 'CashShift_userId_fkey', ['userId']],
    ['CateringEvent', 'CateringEvent_branchId_idx', 'CateringEvent_branchId_fkey', ['branchId']],
    ['CateringEvent', 'CateringEvent_companyId_idx', 'CateringEvent_companyId_fkey', ['companyId']],
    ['CateringEvent', 'CateringEvent_customerId_idx', 'CateringEvent_customerId_fkey', ['customerId']],
    ['CateringMenuItem', 'CateringMenuItem_cateringEventId_idx', 'CateringMenuItem_cateringEventId_fkey', ['cateringEventId']],
    ['CateringMenuItem', 'CateringMenuItem_menuItemId_idx', 'CateringMenuItem_menuItemId_fkey', ['menuItemId']],
    ['CateringPayment', 'CateringPayment_cateringEventId_idx', 'CateringPayment_cateringEventId_fkey', ['cateringEventId']],
    ['CateringServiceItem', 'CateringServiceItem_cateringEventId_idx', 'CateringServiceItem_cateringEventId_fkey', ['cateringEventId']],
    ['Customer', 'Customer_companyId_idx', 'Customer_companyId_fkey', ['companyId']],
    ['MenuItem', 'MenuItem_branchId_idx', 'MenuItem_branchId_fkey', ['branchId']],
    ['Modifier', 'Modifier_modifierGroupId_idx', 'Modifier_modifierGroupId_fkey', ['modifierGroupId']],
    ['Order', 'Order_tableId_idx', 'Order_tableId_fkey', ['tableId']],
    ['Order', 'Order_userId_idx', 'Order_userId_fkey', ['userId']],
    ['OrderItem', 'OrderItem_menuItemId_idx', 'OrderItem_menuItemId_fkey', ['menuItemId']],
    ['OrderItem', 'OrderItem_orderId_idx', 'OrderItem_orderId_fkey', ['orderId']],
    ['OrderItemModifier', 'OrderItemModifier_modifierId_idx', 'OrderItemModifier_modifierId_fkey', ['modifierId']],
    ['OrderItemModifier', 'OrderItemModifier_orderItemId_idx', 'OrderItemModifier_orderItemId_fkey', ['orderItemId']],
    ['Payment', 'Payment_orderId_idx', 'Payment_orderId_fkey', ['orderId']],
    ['Payment', 'Payment_paymentMethodId_idx', 'Payment_paymentMethodId_fkey', ['paymentMethodId']],
    ['Product', 'Product_categoryId_idx', 'Product_categoryId_fkey', ['categoryId']],
    ['PurchaseOrder', 'PurchaseOrder_companyId_idx', 'PurchaseOrder_companyId_fkey', ['companyId']],
    ['PurchaseOrder', 'PurchaseOrder_supplierId_idx', 'PurchaseOrder_supplierId_fkey', ['supplierId']],
    ['PurchaseOrderItem', 'PurchaseOrderItem_productId_idx', 'PurchaseOrderItem_productId_fkey', ['productId']],
    ['PurchaseOrderItem', 'PurchaseOrderItem_purchaseOrderId_idx', 'PurchaseOrderItem_purchaseOrderId_fkey', ['purchaseOrderId']],
    ['Reservation', 'Reservation_branchId_idx', 'Reservation_branchId_fkey', ['branchId']],
    ['Reservation', 'Reservation_companyId_idx', 'Reservation_companyId_fkey', ['companyId']],
    ['Stock', 'Stock_companyId_idx', 'Stock_companyId_fkey', ['companyId']],
    ['Supplier', 'Supplier_companyId_idx', 'Supplier_companyId_fkey', ['companyId']],
    ['Table', 'Table_companyId_idx', 'Table_companyId_fkey', ['companyId']],
    ['UserRole', 'UserRole_roleId_idx', 'UserRole_roleId_fkey', ['roleId']],
] as const;

type IndexRow = {
    Key_name: string;
    Column_name: string;
    Seq_in_index: bigint | number;
};

async function getIndexes(prisma: PrismaClient, tableName: string) {
    const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(`SHOW INDEX FROM \`${tableName}\``);
    const grouped = new Map<string, string[]>();

    for (const row of indexes.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))) {
        const existing = grouped.get(row.Key_name) ?? [];
        existing.push(row.Column_name);
        grouped.set(row.Key_name, existing);
    }

    return grouped;
}

async function main() {
    const prisma = new PrismaClient();

    try {
        console.log('Synchronizing legacy index names...');

        for (const [tableName, newIndex, oldIndex, columns] of INDEX_RENAMES) {
            const indexesBefore = await getIndexes(prisma, tableName);
            const hasNewIndex = indexesBefore.has(newIndex);

            if (!hasNewIndex) {
                const columnList = columns.map(column => `\`${column}\``).join(', ');
                console.log(`Creating ${newIndex} on ${tableName} (${columns.join(', ')})`);
                await prisma.$executeRawUnsafe(`CREATE INDEX \`${newIndex}\` ON \`${tableName}\`(${columnList})`);
            }

            if (oldIndex) {
                const indexesAfter = await getIndexes(prisma, tableName);
                const hasOldIndex = indexesAfter.has(oldIndex);

                if (!hasOldIndex) {
                    continue;
                }

                console.log(`Dropping legacy index ${oldIndex} on ${tableName}`);
                await prisma.$executeRawUnsafe(`DROP INDEX \`${oldIndex}\` ON \`${tableName}\``);
            }
        }

        console.log('Legacy indexes synchronized successfully.');
    } catch (error) {
        console.error('Error synchronizing legacy indexes:', error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    void main();
}
