import * as ExcelJS from 'exceljs';
import prisma from '../utils/prisma';

export class ProductImportService {
    static async generateTemplate(companyId: number): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();

        const instructionsSheet = workbook.addWorksheet('Instrucciones');
        instructionsSheet.columns = [
            { header: 'Campo', key: 'field', width: 22 },
            { header: 'Descripción', key: 'description', width: 55 },
            { header: 'Requerido', key: 'required', width: 12 },
        ];
        instructionsSheet.addRows([
            { field: 'SKU', description: 'Código único del producto. Si existe, se actualizará.', required: 'SÍ' },
            { field: 'Nombre', description: 'Nombre del producto', required: 'SÍ' },
            { field: 'Categoría', description: 'Nombre exacto de la categoría (ver pestaña Categorías)', required: 'NO' },
            { field: 'Unidad', description: 'Unidad de medida (ej: unidad, kg, lb, litro)', required: 'SÍ' },
            { field: 'Stock Mínimo', description: 'Cantidad mínima para alertas de stock bajo', required: 'NO' },
            { field: 'Costo', description: 'Costo unitario del producto', required: 'NO' },
            { field: 'Precio Venta', description: 'Precio de venta al público', required: 'NO' },
            { field: 'Tipo', description: 'INGREDIENT, PRODUCT_FOR_SALE o BOTH', required: 'NO' },
            { field: 'Almacenamiento', description: 'PERISHABLE, FROZEN o NON_PERISHABLE', required: 'NO' },
        ]);
        instructionsSheet.getRow(1).font = { bold: true };
        instructionsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
        instructionsSheet.getCell('A12').value = 'IMPORTANTE: Si el SKU ya existe, el producto se actualizará con los nuevos datos. Si no existe, se creará uno nuevo.';
        instructionsSheet.getCell('A12').font = { italic: true, color: { argb: 'FFFF0000' } };
        instructionsSheet.getCell('A13').value = 'Los campos vacíos en filas de actualización no sobrescriben valores existentes.';
        instructionsSheet.getCell('A13').font = { italic: true, color: { argb: 'FF666666' } };

        const dataSheet = workbook.addWorksheet('Productos');
        dataSheet.columns = [
            { header: 'SKU', key: 'sku', width: 18 },
            { header: 'Nombre', key: 'name', width: 35 },
            { header: 'Categoría', key: 'category', width: 20 },
            { header: 'Unidad', key: 'unit', width: 12 },
            { header: 'Stock Mínimo', key: 'minStock', width: 14 },
            { header: 'Costo', key: 'cost', width: 14 },
            { header: 'Precio Venta', key: 'price', width: 14 },
            { header: 'Tipo', key: 'type', width: 20 },
            { header: 'Almacenamiento', key: 'storageType', width: 18 },
        ];
        dataSheet.getRow(1).font = { bold: true };
        dataSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        dataSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        dataSheet.addRow(['SKU-001', 'Producto Ejemplo', 'Bebidas', 'unidad', 10, 5.50, 12.00, 'PRODUCT_FOR_SALE', 'NON_PERISHABLE']);
        dataSheet.getRow(2).font = { italic: true, color: { argb: 'FF999999' } };

        const categoriesSheet = workbook.addWorksheet('Categorías');
        categoriesSheet.columns = [
            { header: 'Nombre', key: 'name', width: 30 },
            { header: 'Descripción', key: 'description', width: 40 },
        ];
        const categories = await prisma.category.findMany({
            where: { companyId, active: true },
            select: { name: true, description: true },
            orderBy: { name: 'asc' },
        });
        categoriesSheet.addRows(categories.map(c => ({ name: c.name, description: c.description || '' })));
        categoriesSheet.getRow(1).font = { bold: true };
        categoriesSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

        const existingSheet = workbook.addWorksheet('Productos Actuales');
        existingSheet.columns = [
            { header: 'SKU', key: 'sku', width: 18 },
            { header: 'Nombre', key: 'name', width: 35 },
            { header: 'Categoría', key: 'category', width: 20 },
            { header: 'Unidad', key: 'unit', width: 12 },
            { header: 'Tipo', key: 'type', width: 20 },
        ];
        const existingProducts = await prisma.product.findMany({
            where: { companyId, active: true },
            select: { sku: true, name: true, unit: true, type: true, category: { select: { name: true } } },
            orderBy: { name: 'asc' },
        });
        existingSheet.addRows(existingProducts.map(p => ({
            sku: p.sku || '',
            name: p.name,
            category: p.category?.name || '',
            unit: p.unit,
            type: p.type,
        })));
        existingSheet.getRow(1).font = { bold: true };
        existingSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

        const buf = await workbook.xlsx.writeBuffer();
        return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }

    static async validateExcel(fileBuffer: Buffer, companyId: number) {
        const workbook = new ExcelJS.Workbook();
        await (workbook.xlsx.load as unknown as (buffer: Buffer) => Promise<ExcelJS.Workbook>)(fileBuffer);

        const sheet = workbook.getWorksheet('Productos') || workbook.worksheets[0];
        if (!sheet) throw new Error('No se encontró la hoja "Productos"');

        const dbProducts = await prisma.product.findMany({
            where: { companyId, active: true },
            select: { id: true, sku: true, name: true },
        });
        const skuMap = new Map<string, number>();
        for (const p of dbProducts) {
            if (p.sku) skuMap.set(p.sku.toLowerCase(), p.id);
        }

        const dbCategories = await prisma.category.findMany({
            where: { companyId, active: true },
            select: { id: true, name: true },
        });
        const categoryMap = new Map<string, number>();
        for (const c of dbCategories) {
            categoryMap.set(c.name.toLowerCase(), c.id);
        }

        const VALID_TYPES = ['INGREDIENT', 'PRODUCT_FOR_SALE', 'BOTH'];
        const VALID_STORAGE = ['PERISHABLE', 'FROZEN', 'NON_PERISHABLE'];

        type ImportRow = {
            rowNumber: number;
            sku: string;
            name: string;
            category: string;
            unit: string;
            minStock: number | null;
            cost: number | null;
            price: number | null;
            type: string;
            storageType: string;
            isUpdate: boolean;
            existingProductId: number | null;
            categoryId: number | null;
            errors: string[];
            isValid: boolean;
        };

        const items: ImportRow[] = [];
        const summary = { valid: 0, invalid: 0, totalRows: 0, newProducts: 0, updates: 0 };
        const seenSkus = new Set<string>();

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const sku = row.getCell(1).value?.toString().trim() || '';
            const name = row.getCell(2).value?.toString().trim() || '';
            const category = row.getCell(3).value?.toString().trim() || '';
            const unit = row.getCell(4).value?.toString().trim() || '';
            const minStockRaw = row.getCell(5).value?.toString().trim();
            const costRaw = row.getCell(6).value?.toString().trim();
            const priceRaw = row.getCell(7).value?.toString().trim();
            const type = row.getCell(8).value?.toString().trim().toUpperCase() || '';
            const storageType = row.getCell(9).value?.toString().trim().toUpperCase() || '';

            if (!sku && !name && !unit) return;

            summary.totalRows++;
            const errors: string[] = [];

            if (!sku) errors.push('SKU es requerido');
            if (!name) errors.push('Nombre es requerido');
            if (!unit) errors.push('Unidad es requerida');

            if (sku && seenSkus.has(sku.toLowerCase())) {
                errors.push(`SKU "${sku}" duplicado en el archivo`);
            }
            if (sku) seenSkus.add(sku.toLowerCase());

            const minStock = minStockRaw ? parseFloat(minStockRaw) : null;
            if (minStockRaw && (isNaN(minStock!) || minStock! < 0)) {
                errors.push('Stock Mínimo debe ser un número >= 0');
            }

            const cost = costRaw ? parseFloat(costRaw) : null;
            if (costRaw && (isNaN(cost!) || cost! < 0)) {
                errors.push('Costo debe ser un número >= 0');
            }

            const price = priceRaw ? parseFloat(priceRaw) : null;
            if (priceRaw && (isNaN(price!) || price! < 0)) {
                errors.push('Precio de venta debe ser un número >= 0');
            }

            if (type && !VALID_TYPES.includes(type)) {
                errors.push(`Tipo inválido. Use: ${VALID_TYPES.join(', ')}`);
            }

            if (storageType && !VALID_STORAGE.includes(storageType)) {
                errors.push(`Almacenamiento inválido. Use: ${VALID_STORAGE.join(', ')}`);
            }

            let categoryId: number | null = null;
            if (category) {
                categoryId = categoryMap.get(category.toLowerCase()) || null;
                if (!categoryId) {
                    errors.push(`Categoría "${category}" no existe`);
                }
            }

            const existingProductId = sku ? (skuMap.get(sku.toLowerCase()) || null) : null;
            const isUpdate = existingProductId !== null;
            const isValid = errors.length === 0;

            if (isValid) {
                summary.valid++;
                if (isUpdate) summary.updates++;
                else summary.newProducts++;
            } else {
                summary.invalid++;
            }

            items.push({
                rowNumber,
                sku,
                name,
                category,
                unit,
                minStock,
                cost,
                price,
                type: type || 'INGREDIENT',
                storageType: storageType || 'NON_PERISHABLE',
                isUpdate,
                existingProductId,
                categoryId,
                errors,
                isValid,
            });
        });

        return { items, summary };
    }

    static async confirmImport(companyId: number, items: Array<{
        sku: string;
        name: string;
        unit: string;
        minStock?: number | null;
        cost?: number | null;
        price?: number | null;
        type?: string;
        storageType?: string;
        isUpdate: boolean;
        existingProductId?: number | null;
        categoryId?: number | null;
    }>) {
        let created = 0;
        let updated = 0;

        await prisma.$transaction(async (tx) => {
            for (const item of items) {
                if (item.isUpdate && item.existingProductId) {
                    const updateData: Record<string, unknown> = {};
                    if (item.name) updateData.name = item.name;
                    if (item.unit) updateData.unit = item.unit;
                    if (item.categoryId) updateData.categoryId = item.categoryId;
                    if (item.minStock !== null && item.minStock !== undefined) updateData.minStock = item.minStock;
                    if (item.cost !== null && item.cost !== undefined) updateData.cost = item.cost;
                    if (item.price !== null && item.price !== undefined) updateData.price = item.price;
                    if (item.type) updateData.type = item.type;
                    if (item.storageType) updateData.storageType = item.storageType;

                    await tx.product.update({
                        where: { id: item.existingProductId },
                        data: updateData,
                    });
                    updated++;
                } else {
                    await tx.product.create({
                        data: {
                            companyId,
                            sku: item.sku,
                            name: item.name,
                            unit: item.unit,
                            categoryId: item.categoryId || undefined,
                            minStock: item.minStock ?? 0,
                            cost: item.cost ?? 0,
                            price: item.price ?? 0,
                            type: (item.type as 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH') || 'INGREDIENT',
                            storageType: (item.storageType as 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE') || 'NON_PERISHABLE',
                        },
                    });
                    created++;
                }
            }
        });

        return { created, updated, total: created + updated };
    }
}
