import prisma from '../utils/prisma';

/**
 * Stock Alert Service
 * Handles low stock detection and alerts
 */
export class StockAlertService {
    /**
     * Get products with stock below minimum threshold
     */
    static async getLowStockProducts(companyId: number, warehouseId?: number) {
        const where: { companyId: number; warehouseId?: number } = { companyId };

        if (warehouseId) {
            where.warehouseId = warehouseId;
        }

        const stocks = await prisma.stock.findMany({
            where,
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        unit: true,
                        minStock: true,
                        cost: true
                    }
                },
                warehouse: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: { name: true }
                        }
                    }
                }
            }
        });

        // Filter products where quantity < minStock
        return stocks.filter((stock) => {
            if (!stock.product) return false;
            return Number(stock.quantity) < Number(stock.product.minStock);
        }).map((stock) => ({
            productId: stock.product.id,
            productName: stock.product.name,
            sku: stock.product.sku,
            unit: stock.product.unit,
            currentStock: Number(stock.quantity),
            minStock: Number(stock.product.minStock),
            deficit: Number(stock.product.minStock) - Number(stock.quantity),
            warehouseId: stock.warehouse.id,
            warehouseName: stock.warehouse.name,
            branchName: stock.warehouse.branch?.name
        }));
    }

    /**
     * Get stock alert summary for dashboard
     */
    static async getAlertSummary(companyId: number) {
        const lowStockProducts = await this.getLowStockProducts(companyId);

        return {
            totalAlerts: lowStockProducts.length,
            criticalAlerts: lowStockProducts.filter((p) => p.currentStock === 0).length,
            warningAlerts: lowStockProducts.filter((p) => p.currentStock > 0).length,
            products: lowStockProducts.slice(0, 10) // Top 10 for quick view
        };
    }

    /**
     * Check if a specific product needs restocking
     */
    static async checkProductStock(productId: number, companyId: number) {
        const stocks = await prisma.stock.findMany({
            where: { productId, companyId },
            include: {
                product: {
                    select: { minStock: true, name: true }
                },
                warehouse: {
                    select: { name: true }
                }
            }
        });

        const alerts = stocks
            .filter((s) => s.product && Number(s.quantity) < Number(s.product.minStock))
            .map((s) => ({
                warehouse: s.warehouse.name,
                current: Number(s.quantity),
                minimum: Number(s.product.minStock),
                needsRestock: true
            }));

        return {
            productId,
            productName: stocks[0]?.product?.name || 'Unknown',
            hasAlerts: alerts.length > 0,
            alerts
        };
    }
}
