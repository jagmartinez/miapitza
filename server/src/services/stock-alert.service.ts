import prisma from '../utils/prisma';

/**
 * Stock Alert Service
 * Handles low stock detection and alerts
 */
export class StockAlertService {
    /**
     * Products at or below minimum stock (aggregated across warehouses).
     * Matches ProductService.getLowStock so dashboard cards and the inventory grid stay in sync.
     */
    static async getLowStockProducts(companyId: number, warehouseId?: number) {
        const products = await prisma.product.findMany({
            where: { active: true, companyId },
            include: {
                stocks: {
                    where: warehouseId ? { warehouseId } : undefined,
                    include: {
                        warehouse: {
                            select: {
                                id: true,
                                name: true,
                                branch: { select: { name: true } }
                            }
                        }
                    }
                }
            }
        });

        return products
            .filter((product) => StockAlertService.isBelowMinimum(product.stocks, product.minStock))
            .map((product) => {
                const minStock = Number(product.minStock);
                const totalStock = product.stocks.reduce(
                    (sum, stock) => sum + Number(stock.quantity),
                    0
                );
                const primary = product.stocks[0];

                return {
                    productId: product.id,
                    productName: product.name,
                    sku: product.sku,
                    unit: product.unit,
                    currentStock: totalStock,
                    minStock,
                    deficit: Math.max(0, minStock - totalStock),
                    warehouseId: primary?.warehouse.id ?? 0,
                    warehouseName: primary?.warehouse.name ?? 'Sin bodega',
                    branchName: primary?.warehouse.branch?.name
                };
            });
    }

    /** True when total quantity is at or below minStock (and minStock > 0). */
    private static isBelowMinimum(
        stocks: { quantity: unknown }[],
        minStock: unknown
    ): boolean {
        const min = Number(minStock);
        if (min <= 0) return false;
        const total = stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);
        return total <= min;
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
        const product = await prisma.product.findFirst({
            where: { id: productId, companyId },
            select: {
                name: true,
                minStock: true,
                stocks: {
                    include: {
                        warehouse: { select: { name: true } }
                    }
                }
            }
        });

        if (!product) {
            return {
                productId,
                productName: 'Unknown',
                hasAlerts: false,
                alerts: [] as { warehouse: string; current: number; minimum: number; needsRestock: boolean }[]
            };
        }

        const minStock = Number(product.minStock);
        const totalStock = product.stocks.reduce(
            (sum, stock) => sum + Number(stock.quantity),
            0
        );
        const hasAlerts = StockAlertService.isBelowMinimum(product.stocks, product.minStock);

        const alerts = hasAlerts
            ? product.stocks.length > 0
                ? product.stocks
                      .filter((s) => Number(s.quantity) <= minStock)
                      .map((s) => ({
                          warehouse: s.warehouse.name,
                          current: Number(s.quantity),
                          minimum: minStock,
                          needsRestock: true
                      }))
                : [{
                      warehouse: 'Sin bodega',
                      current: totalStock,
                      minimum: minStock,
                      needsRestock: true
                  }]
            : [];

        return {
            productId,
            productName: product.name,
            hasAlerts,
            alerts
        };
    }
}
