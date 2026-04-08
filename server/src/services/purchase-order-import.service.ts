import * as ExcelJS from 'exceljs';
import prisma from '../utils/prisma';

export class PurchaseOrderImportService {
    /**
     * Generates an Excel template for bulk purchase order import
     */
    static async generateTemplate(companyId: number): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();

        // 1. Instructions Sheet
        const instructionsSheet = workbook.addWorksheet('Instrucciones');
        instructionsSheet.columns = [
            { header: 'Campo', key: 'field', width: 20 },
            { header: 'Descripción', key: 'description', width: 50 },
            { header: 'Requerido', key: 'required', width: 15 }
        ];

        instructionsSheet.addRows([
            { field: 'SKU', description: 'Código único del producto (Insumo o Producto)', required: 'SÍ' },
            { field: 'Nombre', description: 'Nombre descriptivo (solo referencia)', required: 'NO' },
            { field: 'Cantidad', description: 'Cantidad a comprar (número mayor a 0)', required: 'SÍ' },
            { header: 'Costo Unitario', description: 'Precio por unidad (número mayor o igual a 0)', required: 'SÍ' }
        ]);

        instructionsSheet.getRow(1).font = { bold: true };
        instructionsSheet.getCell('A7').value = 'IMPORTANTE: Use los SKUs exactos que aparecen en la pestaña "Catálogo de Productos".';
        instructionsSheet.getCell('A7').font = { italic: true, color: { argb: 'FFFF0000' } };

        // 2. Order Data Sheet
        const dataSheet = workbook.addWorksheet('Orden de Compra');
        dataSheet.columns = [
            { header: 'SKU', key: 'sku', width: 20 },
            { header: 'Nombre (Ref)', key: 'name', width: 40 },
            { header: 'Cantidad', key: 'quantity', width: 15 },
            { header: 'Costo Unitario', key: 'unitCost', width: 20 }
        ];

        // Style header
        dataSheet.getRow(1).font = { bold: true };
        dataSheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Add some sample data
        dataSheet.addRow(['SKU-EJEMPLO', 'Producto de Ejemplo', 10, 5.50]);

        // 3. Products Catalog Sheet (for reference)
        const productsSheet = workbook.addWorksheet('Catálogo de Productos');
        productsSheet.columns = [
            { header: 'SKU', key: 'sku', width: 20 },
            { header: 'Nombre', key: 'name', width: 40 },
            { header: 'Unidad', key: 'unit', width: 15 },
            { header: 'Stock Actual', key: 'stock', width: 15 }
        ];

        const products = await prisma.product.findMany({
            where: {
                companyId,
                active: true
            },
            select: {
                sku: true,
                name: true,
                unit: true
            },
            orderBy: { name: 'asc' }
        });

        productsSheet.addRows(products);
        productsSheet.getRow(1).font = { bold: true };

        // Protection - make products sheet read-only (optional)
        // productsSheet.protect('admin123', {});

        const buf = await workbook.xlsx.writeBuffer();
        return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }

    /**
     * Parses and validates a purchase order Excel file
     */
    static async validateExcel(fileBuffer: Buffer, companyId: number) {
        const workbook = new ExcelJS.Workbook();
        await (workbook.xlsx.load as unknown as (buffer: Buffer) => Promise<ExcelJS.Workbook>)(fileBuffer);

        // Find the 'Orden de Compra' sheet or use the first one if not found
        const sheet = workbook.getWorksheet('Orden de Compra') || workbook.worksheets[0];
        type ImportRow = {
            rowNumber: number;
            sku: string | undefined;
            name: string;
            productId: number | null;
            unit: string;
            quantity: number;
            unitCost: number;
            total: number;
            errors: string[];
            isValid: boolean;
        };
        const items: ImportRow[] = [];
        const summary = {
            valid: 0,
            invalid: 0,
            totalRows: 0,
            totalCost: 0
        };

        // Get all active products for SKU validation
        const dbProducts = await prisma.product.findMany({
            where: { companyId, active: true },
            select: { id: true, sku: true, name: true, unit: true }
        });

        type CatalogProduct = (typeof dbProducts)[number];
        const productMap = new Map<string, CatalogProduct>();
        for (const p of dbProducts) {
            if (p.sku) {
                productMap.set(p.sku.toLowerCase(), p);
            }
        }

        // Iterate through rows (skipping header)
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const sku = row.getCell(1).value?.toString().trim();
            const nameRef = row.getCell(2).value?.toString().trim();
            const quantity = parseFloat(row.getCell(3).value?.toString() || '0');
            const unitCost = parseFloat(row.getCell(4).value?.toString() || '0');

            // Skip empty rows
            if (!sku && !quantity && !unitCost) return;

            summary.totalRows++;
            const rowErrors: string[] = [];
            const product = sku ? productMap.get(sku.toLowerCase()) : null;

            if (!sku) {
                rowErrors.push('SKU es requerido');
            } else if (!product) {
                rowErrors.push(`El SKU "${sku}" no existe en el catálogo`);
            }

            if (isNaN(quantity) || quantity <= 0) {
                rowErrors.push('La cantidad debe ser mayor a 0');
            }

            if (isNaN(unitCost) || unitCost < 0) {
                rowErrors.push('El costo unitario debe ser 0 o mayor');
            }

            const isValid = rowErrors.length === 0;
            if (isValid) {
                summary.valid++;
                summary.totalCost += (quantity * unitCost);
            } else {
                summary.invalid++;
            }

            items.push({
                rowNumber,
                sku,
                name: product ? product.name : (nameRef || 'N/A'),
                productId: product ? product.id : null,
                unit: product ? product.unit : 'N/A',
                quantity,
                unitCost,
                total: isValid ? (quantity * unitCost) : 0,
                errors: rowErrors,
                isValid
            });
        });

        return {
            items,
            summary
        };
    }

    /**
     * Confirms the import and creates the purchase order
     */
    static async confirmImport(companyId: number, data: {
        branchId: number;
        supplierId: number;
        invoiceNumber?: string;
        notes?: string;
        items: Array<{
            productId: number;
            quantity: number;
            unitCost: number;
        }>;
    }) {
        // Dynamic import to avoid circular dependency
        const { PurchaseOrderService } = await import('./purchase-order.service');

        // Map data to structure expected by PurchaseOrderService.create
        const poData = {
            branchId: Number(data.branchId),
            supplierId: Number(data.supplierId),
            invoiceNumber: data.invoiceNumber,
            notes: data.notes,
            items: data.items.map(item => ({
                productId: Number(item.productId),
                quantity: Number(item.quantity),
                cost: Number(item.unitCost)
            }))
        };

        return await PurchaseOrderService.create(companyId, poData);
    }
}
