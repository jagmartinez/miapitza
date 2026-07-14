import type { Prisma, Promotion } from '@prisma/client';
import prisma from '../utils/prisma';

export type PromotionValidationCode =
    | 'INVALID_TOTAL'
    | 'INACTIVE'
    | 'NOT_STARTED'
    | 'EXPIRED'
    | 'USAGE_LIMIT'
    | 'MINIMUM_NOT_MET';

export class PromotionValidationError extends Error {
    constructor(public readonly code: PromotionValidationCode) {
        super(code);
        this.name = 'PromotionValidationError';
    }
}

/** Single authoritative promotion calculation used by preview and order writes. */
export function calculatePromotionDiscount(
    promotion: Pick<Promotion, 'active' | 'validFrom' | 'validTo' | 'usageLimit' | 'usageCount' | 'minOrderAmount' | 'type' | 'value' | 'maxDiscount'>,
    orderTotal: number,
    now = new Date()
): number {
    if (!Number.isFinite(orderTotal) || orderTotal < 0) throw new PromotionValidationError('INVALID_TOTAL');
    if (!promotion.active) throw new PromotionValidationError('INACTIVE');
    if (promotion.validFrom > now) throw new PromotionValidationError('NOT_STARTED');
    if (promotion.validTo && promotion.validTo < now) throw new PromotionValidationError('EXPIRED');
    if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
        throw new PromotionValidationError('USAGE_LIMIT');
    }
    if (promotion.minOrderAmount !== null && orderTotal < Number(promotion.minOrderAmount)) {
        throw new PromotionValidationError('MINIMUM_NOT_MET');
    }

    let discount = promotion.type === 'PERCENTAGE'
        ? orderTotal * (Number(promotion.value) / 100)
        : Number(promotion.value);
    if (promotion.maxDiscount !== null) discount = Math.min(discount, Number(promotion.maxDiscount));
    return Math.round(Math.min(Math.max(0, discount), orderTotal) * 100) / 100;
}

/**
 * Promotion Service
 * Handles discounts and promotional codes
 */
export class PromotionService {
    private static normalizeAndValidate(data: {
        code?: string; name?: string; description?: string | null;
        type?: 'PERCENTAGE' | 'FIXED_AMOUNT'; value?: number | Prisma.Decimal;
        minOrderAmount?: number | Prisma.Decimal | null; maxDiscount?: number | Prisma.Decimal | null;
        validFrom?: Date | string; validTo?: Date | string | null;
        usageLimit?: number | null; active?: boolean;
    }) {
        const normalized: Record<string, unknown> = {};
        if (data.code !== undefined) {
            const code = data.code.trim().toUpperCase();
            if (!code) throw new Error('El código de promoción es requerido');
            normalized.code = code;
        }
        if (data.name !== undefined) {
            const name = data.name.trim();
            if (!name) throw new Error('El nombre de promoción es requerido');
            normalized.name = name;
        }
        if (data.description !== undefined) normalized.description = data.description;
        if (data.type !== undefined) normalized.type = data.type;
        if (data.value !== undefined) {
            const value = Number(data.value);
            if (!Number.isFinite(value) || value <= 0) throw new Error('El valor de la promoción debe ser mayor a 0');
            normalized.value = value;
        }
        for (const field of ['minOrderAmount', 'maxDiscount'] as const) {
            if (data[field] === undefined) continue;
            if (data[field] === null) normalized[field] = null;
            else {
                const value = Number(data[field]);
                if (!Number.isFinite(value) || value < 0) throw new Error(`${field} no puede ser negativo`);
                normalized[field] = value;
            }
        }
        if (data.usageLimit !== undefined) {
            if (data.usageLimit === null) normalized.usageLimit = null;
            else if (!Number.isInteger(Number(data.usageLimit)) || Number(data.usageLimit) <= 0) {
                throw new Error('El límite de usos debe ser un entero mayor a 0');
            } else normalized.usageLimit = Number(data.usageLimit);
        }
        if (data.validFrom !== undefined) {
            const validFrom = new Date(data.validFrom);
            if (Number.isNaN(validFrom.getTime())) throw new Error('La fecha inicial no es válida');
            normalized.validFrom = validFrom;
        }
        if (data.validTo !== undefined) {
            if (data.validTo === null) normalized.validTo = null;
            else {
                const validTo = new Date(data.validTo);
                if (Number.isNaN(validTo.getTime())) throw new Error('La fecha final no es válida');
                normalized.validTo = validTo;
            }
        }
        if (data.active !== undefined) normalized.active = data.active;
        return normalized;
    }
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
        const normalized = this.normalizeAndValidate(data);
        const validFrom = (normalized.validFrom as Date | undefined) ?? new Date();
        const validTo = normalized.validTo as Date | null | undefined;
        if (data.type === 'PERCENTAGE' && Number(data.value) > 100) throw new Error('El porcentaje no puede exceder 100');
        if (validTo && validTo < validFrom) throw new Error('La fecha final no puede ser anterior a la fecha inicial');
        return await prisma.promotion.create({
            data: { companyId, ...normalized, validFrom } as Prisma.PromotionUncheckedCreateInput
        });
    }

    /**
     * Update a promotion
     */
    static async update(id: number, companyId: number, data: {
        code?: string; name?: string; description?: string | null;
        type?: 'PERCENTAGE' | 'FIXED_AMOUNT'; value?: number;
        minOrderAmount?: number | null; maxDiscount?: number | null;
        validFrom?: Date | string; validTo?: Date | string | null;
        usageLimit?: number | null; active?: boolean;
    }) {
        const promo = await prisma.promotion.findFirst({ where: { id, companyId } });
        if (!promo) throw new Error('Promoción no encontrada');
        const normalizedData = this.normalizeAndValidate(data) as Prisma.PromotionUpdateInput;
        const nextType = data.type ?? promo.type;
        const nextValue = data.value ?? Number(promo.value);
        if (nextType === 'PERCENTAGE' && nextValue > 100) throw new Error('El porcentaje no puede exceder 100');
        const nextFrom = data.validFrom === undefined ? promo.validFrom : new Date(data.validFrom);
        const nextTo = data.validTo === undefined ? promo.validTo : (data.validTo === null ? null : new Date(data.validTo));
        if (nextTo && nextTo < nextFrom) throw new Error('La fecha final no puede ser anterior a la fecha inicial');
        return await prisma.promotion.update({
            where: { id },
            data: normalizedData
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

        let discount: number;
        try {
            discount = calculatePromotionDiscount(promotion, orderTotal);
        } catch (error) {
            if (!(error instanceof PromotionValidationError)) throw error;
            const messages: Record<PromotionValidationCode, string> = {
                INVALID_TOTAL: 'El total de la orden no es válido',
                INACTIVE: 'Esta promoción ya no está activa',
                NOT_STARTED: 'Esta promoción aún no está vigente',
                EXPIRED: 'Esta promoción ha expirado',
                USAGE_LIMIT: 'Esta promoción ha alcanzado su límite de uso',
                MINIMUM_NOT_MET: `El monto mínimo de compra es ${promotion.minOrderAmount}`
            };
            return { valid: false, discount: 0, message: messages[error.code] };
        }

        const settings = await prisma.setting.findMany({ where: { companyId: promotion.companyId } });
        const currencySymbol = settings.find((s) => s.name === `${promotion.companyId}_currency_symbol`)?.value || 'C$';

        return {
            valid: true,
            discount,
            message: `Descuento de ${currencySymbol}${discount.toFixed(2)} aplicado`,
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
