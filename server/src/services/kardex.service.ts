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
        branchId?: number;
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
                    currentAverageCost: true,
                    baseUnit: {
                        select: {
                            abbreviation: true
                        }
                    }
                }
            });

            if (!product) {
                throw new Error('Product not found');
            }

            // Stock and movements are stored in the product's BASE unit. Prefer the
            // real base-unit abbreviation and fall back to the legacy `unit` string.
            const baseUnitAbbr = product.baseUnit?.abbreviation || product.unit;

            // Build where clause for movements
            const where: Prisma.InventoryMovementWhereInput = {
                productId: filters.productId,
                companyId
            };

            if (filters.warehouseId) {
                where.warehouseId = filters.warehouseId;
            }

            // Branch scope: restrict to warehouses of the branch (+ shared CENTRAL).
            if (filters.branchId) {
                where.warehouse = { OR: [{ branchId: filters.branchId }, { branchId: null }] };
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

            // Calculate opening balance (stock before first movement in range).
            //
            // Balances (balanceQty/balanceCost) are stored PER WAREHOUSE on each
            // movement. When no warehouseId filter is applied the report spans
            // multiple warehouses, so the opening balance must be the sum of the
            // last pre-range balance of EACH warehouse — not a single global movement.
            const openingBalance = { quantity: 0, cost: 0 };
            const openingByWarehouse = new Map<number, { quantity: number; cost: number }>();

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
                if (filters.branchId) {
                    openingWhere.warehouse = { OR: [{ branchId: filters.branchId }, { branchId: null }] };
                }

                // Walk movements oldest-first so the last entry per warehouse wins.
                const previousMovements = await prisma.inventoryMovement.findMany({
                    where: openingWhere,
                    orderBy: {
                        createdAt: 'asc'
                    },
                    select: {
                        warehouseId: true,
                        balanceQty: true,
                        balanceCost: true
                    }
                });

                for (const mv of previousMovements) {
                    openingByWarehouse.set(mv.warehouseId, {
                        quantity: Number(mv.balanceQty || 0),
                        cost: Number(mv.balanceCost || 0)
                    });
                }

                for (const bal of openingByWarehouse.values()) {
                    openingBalance.quantity += bal.quantity;
                    openingBalance.cost += bal.cost;
                }
            }

            // Track a running balance PER WAREHOUSE, seeded from the opening balances.
            // Prefer the stored per-warehouse balance on each movement (authoritative)
            // and only fall back to a computed running balance when it is missing,
            // which avoids double-counting when movements from several warehouses are
            // interleaved in a single chronological report.
            const runningByWarehouse = new Map<number, { quantity: number; cost: number }>();
            for (const [warehouseId, bal] of openingByWarehouse) {
                runningByWarehouse.set(warehouseId, { quantity: bal.quantity, cost: bal.cost });
            }

            const enrichedMovements = movements.map((movement) => {
                const quantity = Number(movement.quantity);
                const unitCost = Number(movement.unitCost || product.currentAverageCost || 0);

                // A TRANSFER has two legs sharing a transferGroupId: the OUT leg (source
                // warehouse) and the IN leg (destination warehouse). Distinguish them by
                // the stored reason so each side shows the correct sign in the kardex.
                const isTransferIn = movement.type === 'TRANSFER'
                    && (movement.reason || '').toLowerCase().startsWith('transfer in');
                const isIncoming = movement.type === 'IN'
                    || movement.type === 'ADJUSTMENT'
                    || isTransferIn;

                let balance: number;
                let balanceCost: number;

                if (movement.balanceQty !== null && movement.balanceCost !== null) {
                    // Stored per-warehouse balance is authoritative.
                    balance = Number(movement.balanceQty);
                    balanceCost = Number(movement.balanceCost);
                } else {
                    // Fall back to a per-warehouse running computation.
                    const prev = runningByWarehouse.get(movement.warehouseId) || { quantity: 0, cost: 0 };
                    if (isIncoming) {
                        balance = prev.quantity + quantity;
                        balanceCost = prev.cost + quantity * unitCost;
                    } else {
                        balance = prev.quantity - quantity;
                        balanceCost = prev.cost - quantity * unitCost;
                    }
                }

                runningByWarehouse.set(movement.warehouseId, { quantity: balance, cost: balanceCost });

                return {
                    id: movement.id,
                    date: movement.createdAt,
                    type: movement.type,
                    reference: movement.reference || '-',
                    reason: movement.reason || '-',
                    in: isIncoming ? quantity : null,
                    out: isIncoming ? null : quantity,
                    balance,
                    unitCost,
                    totalCost: quantity * unitCost,
                    balanceCost,
                    // Original unit/quantity as entered by the user (before conversion
                    // to the base unit). Exposed so the UI can show e.g. "2 caja".
                    originalUnit: movement.originalUnit || null,
                    originalQuantity: movement.originalQuantity !== null
                        ? Number(movement.originalQuantity)
                        : null,
                    warehouse: movement.warehouse.name,
                    branch: movement.warehouse.branch?.name || '-',
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

            // Closing balance is the aggregate of the latest balance across every
            // warehouse touched (opening balances + movements in range). For a
            // single-warehouse report this equals that warehouse's last balance.
            const closingBalance = { quantity: 0, cost: 0 };
            for (const bal of runningByWarehouse.values()) {
                closingBalance.quantity += bal.quantity;
                closingBalance.cost += bal.cost;
            }

            return {
                product,
                baseUnitAbbr,
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
        branchId?: number;
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
                        branchId: filters.branchId,
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
        branchId?: number;
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
                { width: 15 }, // Branch
                { width: 15 }  // User
            ];

            // Title
            worksheet.mergeCells('A1:K1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'KARDEX DE INVENTARIO';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            // Product info
            worksheet.mergeCells('A2:K2');
            const productCell = worksheet.getCell('A2');
            productCell.value = `Producto: ${kardex.product.name} ${kardex.product.sku ? `(${kardex.product.sku})` : ''}`;
            productCell.font = { size: 12, bold: true };

            // Date range
            if (kardex.dateRange.from || kardex.dateRange.to) {
                worksheet.mergeCells('A3:K3');
                const dateCell = worksheet.getCell('A3');
                const from = kardex.dateRange.from ? new Date(kardex.dateRange.from).toLocaleDateString() : 'Inicio';
                const to = kardex.dateRange.to ? new Date(kardex.dateRange.to).toLocaleDateString() : 'Hoy';
                dateCell.value = `Período: ${from} - ${to}`;
                dateCell.font = { size: 11 };
            }

            // Opening balance
            const startRow = kardex.dateRange.from || kardex.dateRange.to ? 5 : 4;
            worksheet.mergeCells(`A${startRow}:K${startRow}`);
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
            const headers = ['Fecha', 'Tipo', 'Referencia', 'Entrada', 'Salida', 'Saldo', 'Costo Unit.', 'Costo Total', 'Almacén', 'Sucursal', 'Usuario'];
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
                    movement.branch,
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
            worksheet.mergeCells(`A${currentRow}:K${currentRow}`);
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
