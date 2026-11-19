import prisma from '../utils/prisma';
import { effectiveUnitCost } from '../utils/product-cost';
import { StockAlertService } from './stock-alert.service';
import { UnitConversionService } from './unit-conversion.service';

type LowStockProductRow = Awaited<ReturnType<typeof StockAlertService.getLowStockProducts>>[number];

/**
 * Auto Purchase Order Service
 * Generates automatic purchase order suggestions based on stock levels
 */
export class AutoPurchaseOrderService {
    /**
     * Generate purchase order suggestions based on low stock
     */
    static async generateSuggestions(companyId: number, warehouseId?: number, branchId?: number) {
        const allLowStock = await StockAlertService.getLowStockProducts(companyId, warehouseId, branchId);

        // D11: products made in-house (ACTIVE ProductionRecipe) are replenished
        // by a production order, not bought. Report them separately.
        const lowStockIds = [...new Set(allLowStock.map((product) => product.productId))];
        const producibleIds = new Set(lowStockIds.length > 0
            ? (await prisma.productionRecipe.findMany({
                where: { companyId, status: 'ACTIVE', productId: { in: lowStockIds } },
                select: { productId: true }
            })).map((recipe) => recipe.productId)
            : []);
        const lowStockProducts = allLowStock.filter((product) => !producibleIds.has(product.productId));
        const toProduce = allLowStock
            .filter((product) => producibleIds.has(product.productId))
            .map((product) => {
                const deficitToTarget = Math.max(0, Number(product.minStock) * 2 - product.currentStock);
                return {
                    productId: product.productId,
                    productName: product.productName,
                    unit: product.unit,
                    currentStock: product.currentStock,
                    minStock: product.minStock,
                    suggestedQuantity: Math.round(deficitToTarget * 1_000_000) / 1_000_000,
                    warehouseId: product.warehouseId,
                    warehouseName: product.warehouseName,
                    priority: product.currentStock <= 0 ? 'URGENT' : 'NORMAL'
                };
            });

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
                        currentAverageCost: true,
                        minStock: true,
                        averageCostKnown: true,
                        referenceCostKnown: true,
                        baseUnitId: true,
                        baseUnit: { select: { abbreviation: true, measurementType: true } },
                        allowedUnits: {
                            where: { companyId, active: true, isDefault: true, unit: { active: true } },
                            select: {
                                unitId: true,
                                conversionFactor: true,
                                unit: { select: { abbreviation: true, measurementType: true } }
                            }
                        }
                    }
                });
                if (!productDetails) {
                    throw new Error(`Producto ${product.productId} ya no existe en la empresa`);
                }

                // Calculate suggested order quantity (order up to 2x minimum)
                const targetStock = Number(product.minStock) * 2;
                const deficitToTarget = Math.max(0, targetStock - product.currentStock);
                const discrete = productDetails.baseUnit?.measurementType === 'UNIT' ||
                    productDetails.baseUnit?.measurementType === 'PACKAGE';
                const suggestedQuantity = discrete
                    ? Math.ceil(deficitToTarget)
                    : Math.round(deficitToTarget * 1_000_000) / 1_000_000;

                // Unrounded per-base-unit cost: base units are often g/ml where a
                // cost like 0.004 must survive until the PO line multiplies it.
                const baseUnitCost = effectiveUnitCost(productDetails.currentAverageCost, productDetails.cost, {
                    averageCostKnown: productDetails.averageCostKnown,
                    referenceCostKnown: productDetails.referenceCostKnown
                });
                const baseUnitAbbreviation = productDetails.baseUnit?.abbreviation || product.unit;

                // Express the suggestion in the product's default purchase unit
                // (e.g. "saco" of 25 kg) when one is configured.
                const defaultPurchase = productDetails.allowedUnits.find((unit) =>
                    unit.unitId !== productDetails.baseUnitId && Number(unit.conversionFactor) > 0
                );
                let purchaseUnit = baseUnitAbbreviation;
                let purchaseQuantity = suggestedQuantity;
                let purchaseUnitCost = baseUnitCost;
                let purchaseConversionFactor = 1;
                if (defaultPurchase && suggestedQuantity > 0) {
                    purchaseConversionFactor = Number(defaultPurchase.conversionFactor);
                    const rawQuantity = suggestedQuantity / purchaseConversionFactor;
                    const discretePurchase = defaultPurchase.unit.measurementType === 'UNIT' ||
                        defaultPurchase.unit.measurementType === 'PACKAGE';
                    purchaseQuantity = discretePurchase
                        ? Math.ceil(rawQuantity - 1e-9)
                        : Math.round(rawQuantity * 1_000_000) / 1_000_000;
                    purchaseUnit = defaultPurchase.unit.abbreviation;
                    purchaseUnitCost = baseUnitCost * purchaseConversionFactor;
                }

                return {
                    productId: product.productId,
                    productName: product.productName,
                    unit: baseUnitAbbreviation,
                    currentStock: product.currentStock,
                    minStock: product.minStock,
                    // Deficit in base unit (kept for compatibility/display).
                    suggestedQuantity,
                    baseUnitCost,
                    // What the PO line should carry: quantity + unit + cost per that unit.
                    purchaseUnit,
                    purchaseQuantity,
                    purchaseUnitCost,
                    purchaseConversionFactor,
                    estimatedCost: Math.round(purchaseQuantity * purchaseUnitCost * 100) / 100,
                    warehouseId: product.warehouseId,
                    warehouseName: product.warehouseName,
                    priority: product.currentStock <= 0 ? 'URGENT' : 'NORMAL'
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
                totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
                toProduceProducts: toProduce.length
            },
            suggestions,
            toProduce
        };
    }

    /**
     * Create purchase order from suggestions
     */
    static async createFromSuggestions(
        companyId: number,
        branchId: number,
        supplierId: number,
        items: { productId: number; quantity: number; cost?: number | null; unit?: string | null }[]
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
                where: { id: { in: uniqueProductIds }, companyId, active: true },
                select: {
                    id: true,
                    unit: true,
                    cost: true,
                    currentAverageCost: true,
                    averageCostKnown: true,
                    referenceCostKnown: true,
                    baseUnit: { select: { abbreviation: true } }
                }
            });
            if (products.length !== uniqueProductIds.length) {
                throw new Error('Uno o más productos no pertenecen a la empresa');
            }

            for (const item of items) {
                if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
                    throw new Error(`Cantidad inválida para producto ${item.productId}`);
                }
                if (item.cost != null && (!Number.isFinite(Number(item.cost)) || Number(item.cost) < 0)) {
                    throw new Error(`Costo inválido para producto ${item.productId}`);
                }
                if (item.unit != null && (typeof item.unit !== 'string' || !item.unit.trim())) {
                    throw new Error(`Unidad inválida para producto ${item.productId}`);
                }
            }

            const productById = new Map(products.map((product) => [product.id, product]));

            // Each line is in the unit the suggestion was expressed in (default
            // purchase unit or base unit). convertWithCost rejects units that are
            // not valid for the product, so the base quantity stays exact.
            const itemCreates = [];
            for (const item of items) {
                const product = productById.get(item.productId)!;
                const quantity = Number(item.quantity);
                const requestedUnit = item.unit?.trim() || product.baseUnit?.abbreviation || product.unit;
                const factorProbe = await UnitConversionService.convertWithCost(
                    item.productId, companyId, quantity, requestedUnit, 0, tx
                );
                // Cost omitted: derive it on the server from the unrounded
                // per-base-unit cost instead of trusting a rounded client value.
                const cost = item.cost != null
                    ? Number(item.cost)
                    : effectiveUnitCost(product.currentAverageCost, product.cost, {
                        averageCostKnown: product.averageCostKnown,
                        referenceCostKnown: product.referenceCostKnown
                    }) * factorProbe.conversionFactor;
                const baseCost = cost / factorProbe.conversionFactor;

                itemCreates.push({
                    productId: item.productId,
                    quantity,
                    cost,
                    subtotal: quantity * cost,
                    purchaseUnit: factorProbe.originalUnit,
                    conversionFactor: factorProbe.conversionFactor,
                    baseQuantity: factorProbe.baseQuantity,
                    baseCost
                });
            }

            const total = Math.round((itemCreates.reduce((sum, item) => sum + item.subtotal, 0) + Number.EPSILON) * 100) / 100;

            return await tx.purchaseOrder.create({
                data: {
                    companyId,
                    branchId,
                    supplierId,
                    // A suggestion is only a draft: nothing has been paid yet. The
                    // CASH default is settled on receipt (receive()), and can be
                    // switched to CREDIT while the order is still a draft.
                    status: 'DRAFT',
                    total,
                    invoiceType: 'CASH',
                    paymentStatus: 'PENDING',
                    paidAmount: 0,
                    items: {
                        create: itemCreates
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
                cost: true,
                currentAverageCost: true
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
            estimatedCost: effectiveUnitCost(product.currentAverageCost, product.cost)
        };
    }
}
