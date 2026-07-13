import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PromotionService } from '../../services/promotion.service';

describe('PromotionService.validateAndApply', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('applies fixed amount discount using server-computed discount', async () => {
        jest.spyOn(prisma.promotion, 'findFirst').mockResolvedValue({
            id: 10,
            companyId: 1,
            code: 'SAVE10',
            name: 'Save 10',
            description: null,
            type: 'FIXED_AMOUNT',
            value: 10 as unknown as never,
            minOrderAmount: null,
            maxDiscount: null,
            validFrom: new Date(Date.now() - 60_000),
            validTo: null,
            usageLimit: null,
            usageCount: 0,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        } as never);
        jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([]);

        const result = await PromotionService.validateAndApply('save10', 120, 1);

        expect(result.valid).toBe(true);
        expect(result.discount).toBe(10);
        expect(result.message).toContain('10.00');
    });

    it('caps percentage discount by maxDiscount and order total', async () => {
        jest.spyOn(prisma.promotion, 'findFirst').mockResolvedValue({
            id: 11,
            companyId: 1,
            code: 'BIGPCT',
            name: 'Big Percentage',
            description: null,
            type: 'PERCENTAGE',
            value: 90 as unknown as never,
            minOrderAmount: null,
            maxDiscount: 25 as unknown as never,
            validFrom: new Date(Date.now() - 60_000),
            validTo: null,
            usageLimit: null,
            usageCount: 0,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date()
        } as never);
        jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([]);

        const result = await PromotionService.validateAndApply('BIGPCT', 20, 1);

        // 90% of 20 is 18; maxDiscount 25 should not lower it, but must still be <= order total.
        expect(result.valid).toBe(true);
        expect(result.discount).toBe(18);
    });

    it('rejects invalid date ranges before writing', async () => {
        const create = jest.spyOn(prisma.promotion, 'create');
        await expect(PromotionService.create(1, {
            code: 'DATE', name: 'Invalid date', type: 'PERCENTAGE', value: 10,
            validFrom: new Date('invalid')
        })).rejects.toThrow('fecha inicial');
        expect(create).not.toHaveBeenCalled();
    });

    it('rejects percentages over 100 before writing', async () => {
        const create = jest.spyOn(prisma.promotion, 'create');
        await expect(PromotionService.create(1, {
            code: 'TOO-MUCH', name: 'Too much', type: 'PERCENTAGE', value: 101
        })).rejects.toThrow('100');
        expect(create).not.toHaveBeenCalled();
    });
});
