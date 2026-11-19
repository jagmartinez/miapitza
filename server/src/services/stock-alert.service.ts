import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export const NEGATIVE_SALE_STOCK_ACTION = 'NEGATIVE_STOCK_SALE';

/**
 * Stock Alert Service
 * Handles low stock detection and alerts
 */
export class StockAlertService {
    /**
     * Products at or below minimum stock (aggregated across warehouses).
     * Matches ProductService.getLowStock so dashboard cards and the inventory grid stay in sync.
     */
    static async getLowStockProducts(companyId: number, warehouseId?: number, branchId?: number) {
        const stockWhere = {
            ...(warehouseId ? { warehouseId } : {}),
            // Branch-scoped users only count stock in their branch + shared CENTRAL warehouses.
            ...(branchId ? { warehouse: { OR: [{ branchId }, { branchId: null }] } } : {})
        };
        const products = await prisma.product.findMany({
            where: { active: true, companyId },
            include: {
                baseUnit: { select: { abbreviation: true } },
                stocks: {
                    where: Object.keys(stockWhere).length ? stockWhere : undefined,
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
                    unit: product.baseUnit?.abbreviation || product.unit,
                    currentStock: totalStock,
                    minStock,
                    deficit: Math.max(0, minStock - totalStock),
                    warehouseId: primary?.warehouse.id ?? 0,
                    warehouseName: primary?.warehouse.name ?? 'Sin bodega',
                    branchName: primary?.warehouse.branch?.name
                };
            });
    }

    /**
     * True when total quantity is at or below minStock (and minStock > 0), or
     * when any warehouse balance is negative (an oversold sale), regardless of
     * the configured minimum.
     */
    private static isBelowMinimum(
        stocks: { quantity: unknown }[],
        minStock: unknown
    ): boolean {
        if (stocks.some((stock) => Number(stock.quantity) < 0)) return true;
        const min = Number(minStock);
        if (min <= 0) return false;
        const total = stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);
        return total <= min;
    }

    /**
     * Records, inside the caller's transaction, that a sale drove one or more
     * products below zero. Sales of an already-sold order are never blocked by
     * stock; this audit row (plus the negative balance itself, which the
     * low-stock alert always reports) is the operator's signal to reconcile.
     */
    static async recordNegativeSaleStock(
        tx: Prisma.TransactionClient,
        params: {
            companyId: number;
            warehouseId: number;
            userId: number;
            reference: string;
            /** Entity id of the alert (order id, or the `entityType` row id). */
            orderId: number;
            /** AuditLog entity (default `Order`), e.g. `CateringEvent`. */
            entityType?: string;
            products: Array<{ productId: number; productName: string; balance: number }>;
        }
    ): Promise<void> {
        if (params.products.length === 0) return;
        for (const product of params.products) {
            console.warn(
                `[StockAlert] Venta ${params.reference} dejó "${product.productName}" (#${product.productId}) ` +
                `en ${product.balance} en almacén ${params.warehouseId} (empresa ${params.companyId})`
            );
        }
        await tx.auditLog.create({
            data: {
                companyId: params.companyId,
                entityType: params.entityType ?? 'Order',
                entityId: params.orderId,
                action: NEGATIVE_SALE_STOCK_ACTION,
                userId: params.userId,
                details: {
                    reference: params.reference,
                    warehouseId: params.warehouseId,
                    products: params.products
                }
            }
        });
    }

    /**
     * Get stock alert summary for dashboard
     */
    static async getAlertSummary(companyId: number, branchId?: number) {
        const lowStockProducts = await this.getLowStockProducts(companyId, undefined, branchId);

        return {
            totalAlerts: lowStockProducts.length,
            criticalAlerts: lowStockProducts.filter((p) => p.currentStock <= 0).length,
            warningAlerts: lowStockProducts.filter((p) => p.currentStock > 0).length,
            products: lowStockProducts.slice(0, 10) // Top 10 for quick view
        };
    }

    /**
     * Check if a specific product needs restocking
     */
    static async checkProductStock(productId: number, companyId: number, branchId?: number) {
        const product = await prisma.product.findFirst({
            where: { id: productId, companyId },
            select: {
                name: true,
                minStock: true,
                stocks: {
                    where: branchId ? { warehouse: { OR: [{ branchId }, { branchId: null }] } } : undefined,
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
