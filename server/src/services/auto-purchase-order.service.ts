import prisma from '../utils/prisma';
import { StockAlertService } from './stock-alert.service';

type LowStockProductRow = Awaited<ReturnType<typeof StockAlertService.getLowStockProducts>>[number];

/**
 * Auto Purchase Order Service
 * Generates automatic purchase order suggestions based on stock levels
 */
export class AutoPurchaseOrderService {
    /**
     * Generate purchase order suggestions based on low stock
     */
    static async generateSuggestions(companyId: number, warehouseId?: number) {
        const lowStockProducts = await StockAlertService.getLowStockProducts(companyId, warehouseId);

        // Group by supplier if products have preferred suppliers
        const suggestions = await Promise.all(
            lowStockProducts.map(async (product: LowStockProductRow) => {
                // Get product details with supplier info
                const productDetails = await prisma.product.findFirst({
                    where: { id: product.productId, companyId },
                    select: {
                        id: true,
                        name: true,
                        unit: true,
                        cost: true,
                        minStock: true
                    }
                });

                // Calculate suggested order quantity (order up to 2x minimum)
                const targetStock = Number(product.minStock) * 2;
                const suggestedQuantity = Math.ceil(targetStock - product.currentStock);

                return {
                    productId: product.productId,
                    productName: product.productName,
                    unit: product.unit,
                    currentStock: product.currentStock,
                    minStock: product.minStock,
                    suggestedQuantity,
                    estimatedCost: Math.round(suggestedQuantity * Number(productDetails?.cost || 0) * 100) / 100,
                    warehouseId: product.warehouseId,
                    warehouseName: product.warehouseName,
                    priority: product.currentStock === 0 ? 'URGENT' : 'NORMAL'
                };
            })
        );

        // Sort by priority and deficit
        suggestions.sort((a, b) => {
            if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
            if (b.priority === 'URGENT' && a.priority !== 'URGENT') return 1;
            return b.suggestedQuantity - a.suggestedQuantity;
        });

        const totalEstimatedCost = suggestions.reduce((sum, s) => sum + s.estimatedCost, 0);

        return {
            generatedAt: new Date().toISOString(),
            summary: {
                totalProducts: suggestions.length,
                urgentProducts: suggestions.filter(s => s.priority === 'URGENT').length,
                totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100
            },
            suggestions
        };
    }

    /**
     * Create purchase order from suggestions
     */
    static async createFromSuggestions(
        companyId: number,
        branchId: number,
        supplierId: number,
        items: { productId: number; quantity: number; cost: number }[]
    ) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Debe enviar al menos un producto para la orden de compra');
        }

        return await prisma.$transaction(async (tx) => {
            const branch = await tx.branch.findFirst({
                where: { id: branchId, companyId },
                select: { id: true }
            });
            if (!branch) {
                throw new Error('Sucursal no encontrada');
            }

            const supplier = await tx.supplier.findFirst({
                where: { id: supplierId, companyId, active: true },
                select: { id: true }
            });
            if (!supplier) {
                throw new Error('Proveedor no encontrado o inactivo');
            }

            const uniqueProductIds = Array.from(new Set(items.map((item) => item.productId)));
            const products = await tx.product.findMany({
                where: { id: { in: uniqueProductIds }, companyId },
                select: { id: true }
            });
            if (products.length !== uniqueProductIds.length) {
                throw new Error('Uno o más productos no pertenecen a la empresa');
            }

            for (const item of items) {
                if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
                    throw new Error(`Cantidad inválida para producto ${item.productId}`);
                }
                if (!Number.isFinite(item.cost) || item.cost < 0) {
                    throw new Error(`Costo inválido para producto ${item.productId}`);
                }
            }

            const total = items.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

            return await tx.purchaseOrder.create({
                data: {
                    companyId,
                    branchId,
                    supplierId,
                    status: 'DRAFT',
                    total,
                    items: {
                        create: items.map(item => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            cost: item.cost,
                            subtotal: item.quantity * item.cost
                        }))
                    }
                },
                include: {
                    items: {
                        include: { product: true }
                    },
                    supplier: true
                }
            });
        });
    }

    /**
     * Get reorder settings for a product
     */
    static async getReorderSettings(productId: number, companyId: number) {
        const product = await prisma.product.findFirst({
            where: { id: productId, companyId },
            select: {
                id: true,
                name: true,
                minStock: true,
                cost: true
            }
        });

        if (!product) {
            throw new Error('Producto no encontrado');
        }

        return {
            productId: product.id,
            productName: product.name,
            minStock: Number(product.minStock),
            reorderPoint: Number(product.minStock), // Currently same as minStock
            reorderQuantity: Number(product.minStock) * 2, // Order up to 2x minimum
            estimatedCost: Number(product.cost)
        };
    }
}
