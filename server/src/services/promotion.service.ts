import type { Prisma, Promotion } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Promotion Service
 * Handles discounts and promotional codes
 */
export class PromotionService {
    /**
     * Get all promotions for a company
     */
    static async getAll(companyId: number, activeOnly = true) {
        const where: Prisma.PromotionWhereInput = { companyId };

        if (activeOnly) {
            where.active = true;
            where.validFrom = { lte: new Date() };
            where.OR = [
                { validTo: null },
                { validTo: { gte: new Date() } }
            ];
        }

        return await prisma.promotion.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Get promotion by code
     */
    static async getByCode(code: string, companyId: number) {
        // companyId is required so a code belonging to another tenant can never be returned.
        return await prisma.promotion.findFirst({
            where: { code: code.toUpperCase(), companyId }
        });
    }

    /**
     * Create a new promotion
     */
    static async create(companyId: number, data: {
        code: string;
        name: string;
        description?: string;
        type: 'PERCENTAGE' | 'FIXED_AMOUNT';
        value: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        validFrom?: Date;
        validTo?: Date;
        usageLimit?: number;
    }) {
        return await prisma.promotion.create({
            data: {
                companyId,
                ...data,
                code: data.code.toUpperCase() // Normalize to uppercase for consistent lookups
            }
        });
    }

    /**
     * Update a promotion
     */
    static async update(id: number, companyId: number, data: Prisma.PromotionUpdateInput) {
        const promo = await prisma.promotion.findFirst({ where: { id, companyId } });
        if (!promo) throw new Error('Promoción no encontrada');
        return await prisma.promotion.update({
            where: { id },
            data
        });
    }

    /**
     * Validate and apply promotion to an order
     */
    static async validateAndApply(code: string, orderTotal: number, companyId: number): Promise<{
        valid: boolean;
        discount: number;
        message: string;
        promotion?: Promotion;
    }> {
        const promotion = await this.getByCode(code.toUpperCase(), companyId);

        if (!promotion) {
            return { valid: false, discount: 0, message: 'Código de promoción no encontrado' };
        }

        if (!promotion.active) {
            return { valid: false, discount: 0, message: 'Esta promoción ya no está activa' };
        }

        const now = new Date();
        if (promotion.validFrom && new Date(promotion.validFrom) > now) {
            return { valid: false, discount: 0, message: 'Esta promoción aún no está vigente' };
        }

        if (promotion.validTo && new Date(promotion.validTo) < now) {
            return { valid: false, discount: 0, message: 'Esta promoción ha expirado' };
        }

        if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
            return { valid: false, discount: 0, message: 'Esta promoción ha alcanzado su límite de uso' };
        }

        if (promotion.minOrderAmount && orderTotal < Number(promotion.minOrderAmount)) {
            return {
                valid: false,
                discount: 0,
                message: `El monto mínimo de compra es C$${promotion.minOrderAmount}`
            };
        }

        // Calculate discount
        let discount = 0;
        if (promotion.type === 'PERCENTAGE') {
            discount = orderTotal * (Number(promotion.value) / 100);
        } else {
            discount = Number(promotion.value);
        }

        // Apply max discount cap if exists
        if (promotion.maxDiscount && discount > Number(promotion.maxDiscount)) {
            discount = Number(promotion.maxDiscount);
        }

        // Cap discount to order total — never give more discount than the order value
        discount = Math.min(discount, orderTotal);

        const settings = await prisma.setting.findMany({ where: { companyId: promotion.companyId } });
        const currencySymbol = settings.find((s) => s.name === 'currency_symbol')?.value || 'C$';

        const roundedDiscount = Math.round(discount * 100) / 100;

        return {
            valid: true,
            discount: roundedDiscount,
            message: `Descuento de ${currencySymbol}${roundedDiscount.toFixed(2)} aplicado`,
            promotion
        };
    }

    /**
     * Increment usage count atomically with conditional check to prevent race conditions.
     * Returns null if usage limit was already reached.
     */
    static async incrementUsage(promotionId: number) {
        // Atomic conditional update: only increment if under the limit
        const promotion = await prisma.promotion.findUnique({ where: { id: promotionId } });
        if (!promotion) return null;

        if (promotion.usageLimit) {
            // Use updateMany with a condition to prevent exceeding the limit
            const result = await prisma.promotion.updateMany({
                where: {
                    id: promotionId,
                    OR: [
                        { usageLimit: null },
                        { usageCount: { lt: promotion.usageLimit } }
                    ]
                },
                data: {
                    usageCount: { increment: 1 }
                }
            });
            if (result.count === 0) {
                throw new Error('Promotion usage limit reached');
            }
            return result;
        }

        return await prisma.promotion.update({
            where: { id: promotionId },
            data: {
                usageCount: { increment: 1 }
            }
        });
    }

    /**
     * Deactivate a promotion
     */
    static async deactivate(id: number, companyId: number) {
        const promo = await prisma.promotion.findFirst({ where: { id, companyId } });
        if (!promo) throw new Error('Promoción no encontrada');

        return await prisma.promotion.update({
            where: { id },
            data: { active: false }
        });
    }
}
