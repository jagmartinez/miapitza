import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import ExcelJS from 'exceljs';
import { getErrorMessage } from '../utils/error';

/**
 * Service for generating Kardex (inventory movement) reports
 * Provides detailed movement history with running balances and costs
 */
export class KardexService {
    /**
     * Generate Kardex report for a product
     */
    static async generateKardex(companyId: number, filters: {
        productId: number;
        warehouseId?: number;
        dateFrom?: Date;
        dateTo?: Date;
        type?: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
    }) {
        try {
            // Get product information
            const product = await prisma.product.findFirst({
                where: { id: filters.productId, companyId },
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    unit: true,
                    currentAverageCost: true
                }
            });

            if (!product) {
                throw new Error('Product not found');
            }

            // Build where clause for movements
            const where: Prisma.InventoryMovementWhereInput = {
                productId: filters.productId,
                companyId
            };

            if (filters.warehouseId) {
                where.warehouseId = filters.warehouseId;
            }

            if (filters.dateFrom || filters.dateTo) {
                where.createdAt = {};
                if (filters.dateFrom) {
                    where.createdAt.gte = filters.dateFrom;
                }
                if (filters.dateTo) {
                    where.createdAt.lte = filters.dateTo;
                }
            }

            if (filters.type) {
                where.type = filters.type;
            }

            // Get movements
            const movements = await prisma.inventoryMovement.findMany({
                where,
                include: {
                    warehouse: {
                        select: {
                            id: true,
                            name: true,
                            branch: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    },
                    user: {
                        select: {
                            name: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });

            // Calculate opening balance (stock before first movement in range)
            const openingBalance = { quantity: 0, cost: 0 };

            if (filters.dateFrom) {
                const openingWhere: Prisma.InventoryMovementWhereInput = {
                    productId: filters.productId,
                    companyId,
                    createdAt: {
                        lt: filters.dateFrom
                    }
                };
                if (filters.warehouseId) {
                    openingWhere.warehouseId = filters.warehouseId;
                }

                const previousMovements = await prisma.inventoryMovement.findMany({
                    where: openingWhere,
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                });

                if (previousMovements.length > 0) {
                    const lastMovement = previousMovements[0];
                    openingBalance.quantity = Number(lastMovement.balanceQty || 0);
                    openingBalance.cost = Number(lastMovement.balanceCost || 0);
                }
            }

            // Calculate running balances if not already stored
            let runningBalance = openingBalance.quantity;
            let runningCost = openingBalance.cost;

            const enrichedMovements = movements.map((movement) => {
                const quantity = Number(movement.quantity);
                const unitCost = Number(movement.unitCost || product.currentAverageCost || 0);

                // Calculate balance if not stored
                if (movement.type === 'IN' || movement.type === 'ADJUSTMENT') {
                    runningBalance += quantity;
                    runningCost += quantity * unitCost;
                } else {
                    runningBalance -= quantity;
                    runningCost -= quantity * unitCost;
                }

                // Use stored balance if available, otherwise use calculated
                const balance = movement.balanceQty !== null ? Number(movement.balanceQty) : runningBalance;
                const balanceCost = movement.balanceCost !== null ? Number(movement.balanceCost) : runningCost;

                return {
                    id: movement.id,
                    date: movement.createdAt,
                    type: movement.type,
                    reference: movement.reference || '-',
                    reason: movement.reason || '-',
                    in: (movement.type === 'IN' || movement.type === 'ADJUSTMENT') ? quantity : null,
                    out: (movement.type === 'OUT' || movement.type === 'TRANSFER') ? quantity : null,
                    balance,
                    unitCost,
                    totalCost: quantity * unitCost,
                    balanceCost,
                    warehouse: movement.warehouse.name,
                    user: movement.user.name
                };
            });

            // Calculate totals
            const totals = {
                totalIn: enrichedMovements
                    .filter((m) => m.in !== null)
                    .reduce((sum, m) => sum + (m.in || 0), 0),
                totalOut: enrichedMovements
                    .filter((m) => m.out !== null)
                    .reduce((sum, m) => sum + (m.out || 0), 0)
            };

            const closingBalance = {
                quantity: enrichedMovements.length > 0
                    ? enrichedMovements[enrichedMovements.length - 1].balance
                    : openingBalance.quantity,
                cost: enrichedMovements.length > 0
                    ? enrichedMovements[enrichedMovements.length - 1].balanceCost
                    : openingBalance.cost
            };

            return {
                product,
                warehouse: filters.warehouseId ? movements[0]?.warehouse : null,
                dateRange: {
                    from: filters.dateFrom,
                    to: filters.dateTo
                },
                openingBalance,
                movements: enrichedMovements,
                closingBalance,
                totals: {
                    ...totals,
                    netChange: totals.totalIn - totals.totalOut
                }
            };
        } catch (error: unknown) {
            console.error('[KardexService] Error generating kardex:', error);
            throw new Error(`Failed to generate kardex: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Generate Kardex summary for multiple products
     */
    static async generateKardexSummary(companyId: number, filters: {
        warehouseId?: number;
        categoryId?: number;
        dateFrom?: Date;
        dateTo?: Date;
    }) {
        try {
            const where: Prisma.ProductWhereInput = { companyId, active: true };

            if (filters.categoryId) {
                where.categoryId = filters.categoryId;
            }

            const products = await prisma.product.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    unit: true,
                    currentAverageCost: true
                }
            });

            const summaries = await Promise.all(
                products.map(async (product) => {
                    const kardex = await this.generateKardex(companyId, {
                        productId: product.id,
                        warehouseId: filters.warehouseId,
                        dateFrom: filters.dateFrom,
                        dateTo: filters.dateTo
                    });

                    return {
                        product: kardex.product,
                        openingBalance: kardex.openingBalance,
                        closingBalance: kardex.closingBalance,
                        totals: kardex.totals,
                        movementCount: kardex.movements.length
                    };
                })
            );

            return summaries;
        } catch (error: unknown) {
            console.error('[KardexService] Error generating summary:', error);
            throw new Error(`Failed to generate kardex summary: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Export Kardex to Excel
     */
    static async exportToExcel(companyId: number, filters: {
        productId: number;
        warehouseId?: number;
        dateFrom?: Date;
        dateTo?: Date;
    }): Promise<Buffer> {
        try {
            const kardex = await this.generateKardex(companyId, filters);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Kardex');

            // Set column widths
            worksheet.columns = [
                { width: 12 }, // Date
                { width: 12 }, // Type
                { width: 15 }, // Reference
                { width: 10 }, // In
                { width: 10 }, // Out
                { width: 12 }, // Balance
                { width: 12 }, // Unit Cost
                { width: 12 }, // Total Cost
                { width: 15 }, // Warehouse
                { width: 15 }  // User
            ];

            // Title
            worksheet.mergeCells('A1:J1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'KARDEX DE INVENTARIO';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            // Product info
            worksheet.mergeCells('A2:J2');
            const productCell = worksheet.getCell('A2');
            productCell.value = `Producto: ${kardex.product.name} ${kardex.product.sku ? `(${kardex.product.sku})` : ''}`;
            productCell.font = { size: 12, bold: true };

            // Date range
            if (kardex.dateRange.from || kardex.dateRange.to) {
                worksheet.mergeCells('A3:J3');
                const dateCell = worksheet.getCell('A3');
                const from = kardex.dateRange.from ? new Date(kardex.dateRange.from).toLocaleDateString() : 'Inicio';
                const to = kardex.dateRange.to ? new Date(kardex.dateRange.to).toLocaleDateString() : 'Hoy';
                dateCell.value = `Período: ${from} - ${to}`;
                dateCell.font = { size: 11 };
            }

            // Opening balance
            const startRow = kardex.dateRange.from || kardex.dateRange.to ? 5 : 4;
            worksheet.mergeCells(`A${startRow}:J${startRow}`);
            const openingCell = worksheet.getCell(`A${startRow}`);
            openingCell.value = `Saldo Inicial: ${kardex.openingBalance.quantity} ${kardex.product.unit} @ $${(kardex.openingBalance.cost / kardex.openingBalance.quantity || 0).toFixed(2)} = $${kardex.openingBalance.cost.toFixed(2)}`;
            openingCell.font = { bold: true };
            openingCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            // Headers
            const headerRow = startRow + 2;
            const headers = ['Fecha', 'Tipo', 'Referencia', 'Entrada', 'Salida', 'Saldo', 'Costo Unit.', 'Costo Total', 'Almacén', 'Usuario'];
            const headerRowObj = worksheet.getRow(headerRow);
            headerRowObj.values = headers;
            headerRowObj.font = { bold: true };
            headerRowObj.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' }
            };
            headerRowObj.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRowObj.alignment = { horizontal: 'center', vertical: 'middle' };

            // Data rows
            let currentRow = headerRow + 1;
            kardex.movements.forEach((movement) => {
                const row = worksheet.getRow(currentRow);
                row.values = [
                    new Date(movement.date).toLocaleDateString(),
                    movement.type,
                    movement.reference,
                    movement.in || '',
                    movement.out || '',
                    movement.balance,
                    movement.unitCost,
                    movement.totalCost,
                    movement.warehouse,
                    movement.user
                ];

                // Number formatting
                row.getCell(4).numFmt = '#,##0.000'; // In
                row.getCell(5).numFmt = '#,##0.000'; // Out
                row.getCell(6).numFmt = '#,##0.000'; // Balance
                row.getCell(7).numFmt = '$#,##0.00'; // Unit Cost
                row.getCell(8).numFmt = '$#,##0.00'; // Total Cost

                // Color coding
                if (movement.in) {
                    row.getCell(4).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFD4EDDA' }
                    };
                }
                if (movement.out) {
                    row.getCell(5).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF8D7DA' }
                    };
                }

                currentRow++;
            });

            // Closing balance
            currentRow++;
            worksheet.mergeCells(`A${currentRow}:J${currentRow}`);
            const closingCell = worksheet.getCell(`A${currentRow}`);
            closingCell.value = `Saldo Final: ${kardex.closingBalance.quantity} ${kardex.product.unit} @ $${(kardex.closingBalance.cost / kardex.closingBalance.quantity || 0).toFixed(2)} = $${kardex.closingBalance.cost.toFixed(2)}`;
            closingCell.font = { bold: true };
            closingCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            // Totals
            currentRow += 2;
            worksheet.getCell(`A${currentRow}`).value = `Total Entradas: ${kardex.totals.totalIn} ${kardex.product.unit}`;
            worksheet.getCell(`A${currentRow}`).font = { bold: true };
            currentRow++;
            worksheet.getCell(`A${currentRow}`).value = `Total Salidas: ${kardex.totals.totalOut} ${kardex.product.unit}`;
            worksheet.getCell(`A${currentRow}`).font = { bold: true };
            currentRow++;
            worksheet.getCell(`A${currentRow}`).value = `Cambio Neto: ${kardex.totals.netChange} ${kardex.product.unit}`;
            worksheet.getCell(`A${currentRow}`).font = { bold: true };

            // Add borders to all cells with data
            for (let i = headerRow; i < currentRow - 3; i++) {
                const row = worksheet.getRow(i);
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                });
            }

            // Generate buffer
            const buffer = await workbook.xlsx.writeBuffer();
            return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        } catch (error: unknown) {
            console.error('[KardexService] Error exporting to Excel:', error);
            throw new Error(`Failed to export kardex to Excel: ${getErrorMessage(error)}`);
        }
    }
}
