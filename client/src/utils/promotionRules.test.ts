import { describe, expect, it } from 'vitest';
import {
    describePromotionBranches,
    describePromotionSchedule,
    describePromotionScope,
    describePromotionValue,
    describeWeekdays,
    EMPTY_PROMOTION_RULES,
    promotionPreviewItems,
    promotionRulesForm,
    promotionRulesPayload,
    validatePromotionRules,
} from './promotionRules';

const money = (amount: unknown) => `C$${Number(amount).toFixed(2)}`;

describe('promotion rule labels', () => {
    it('describes values per type', () => {
        expect(describePromotionValue({ type: 'PERCENTAGE', value: 20 }, money)).toBe('20%');
        expect(describePromotionValue({ type: 'FIXED_AMOUNT', value: 10, scope: 'ITEMS' }, money)).toBe('C$10.00 c/u');
        expect(describePromotionValue({ type: 'FIXED_AMOUNT', value: 10 }, money)).toBe('C$10.00');
        expect(describePromotionValue({ type: 'BUY_X_GET_Y', value: 0, buyQuantity: 3, payQuantity: 2 }, money)).toBe('3x2');
        expect(describePromotionValue({ type: 'COMBO', value: 250 }, money)).toBe('Combo C$250.00');
    });

    it('describes happy-hour windows, including ones crossing midnight', () => {
        expect(describeWeekdays([1, 2, 3, 4, 5])).toBe('Lun–Vie');
        expect(describeWeekdays([1, 3, 5])).toBe('Lun, Mié, Vie');
        expect(describeWeekdays(null)).toBe('Todos los días');
        expect(describePromotionSchedule({ weekdays: [1, 2, 3, 4, 5], dailyStartTime: '17:00', dailyEndTime: '19:00' })).toBe('Lun–Vie 17:00–19:00');
        expect(describePromotionSchedule({ weekdays: [5], dailyStartTime: '22:00', dailyEndTime: '02:00' })).toBe('Vie 22:00–02:00 (cruza medianoche)');
        expect(describePromotionSchedule({ weekdays: null, dailyStartTime: null, dailyEndTime: null })).toBeNull();
    });

    it('describes scope and branches', () => {
        expect(describePromotionScope({ type: 'PERCENTAGE', value: 10 })).toBe('Toda la orden');
        expect(describePromotionScope({ type: 'PERCENTAGE', value: 10, scope: 'ITEMS', targetMenuItemIds: [1], targetCategoryIds: [2, 3] })).toBe('1 producto y 2 categorías');
        expect(describePromotionScope({ type: 'COMBO', value: 250, comboItems: [{ menuItemId: 1, quantity: 1, name: 'Hamburguesa' }, { menuItemId: 2, quantity: 2, name: 'Papas' }] }))
            .toBe('Hamburguesa + 2× Papas');
        expect(describePromotionBranches({ allBranches: true })).toBe('Todas las sucursales');
        expect(describePromotionBranches({ allBranches: false, branchIds: [4] }, (id) => (id === 4 ? 'Centro' : undefined))).toBe('Centro');
        expect(describePromotionBranches({ allBranches: false, branchIds: [4, 5] })).toBe('2 sucursales');
    });
});

describe('promotion rule form', () => {
    it('validates like the server (Spanish messages)', () => {
        expect(validatePromotionRules(EMPTY_PROMOTION_RULES)).toBeNull();
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, dailyStartTime: '17:00' })).toBe('Indique hora inicial y hora final del horario');
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, scope: 'ITEMS' })).toBe('Seleccione al menos un producto o categoría para la promoción');
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, allBranches: false })).toBe('Seleccione al menos una sucursal para la promoción');
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, type: 'COMBO', comboItems: [{ menuItemId: 1, quantity: 1 }] }))
            .toBe('El combo debe incluir al menos dos productos');
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, type: 'BUY_X_GET_Y', targetCategoryIds: [2], buyQuantity: '3', payQuantity: '3' }))
            .toMatch(/N x M/);
        expect(validatePromotionRules({ ...EMPTY_PROMOTION_RULES, type: 'BUY_X_GET_Y', targetCategoryIds: [2], buyQuantity: '3', payQuantity: '2' })).toBeNull();
    });

    it('builds the payload and drops fields that do not apply to the type', () => {
        expect(promotionRulesPayload({
            ...EMPTY_PROMOTION_RULES,
            type: 'COMBO', scope: 'ORDER', targetMenuItemIds: [9],
            comboItems: [{ menuItemId: 1, quantity: 1 }, { menuItemId: 2, quantity: 1 }],
            weekdays: [5, 1], dailyStartTime: '22:00', dailyEndTime: '02:00',
            allBranches: false, branchIds: [3],
        })).toEqual({
            scope: 'ITEMS',
            weekdays: [1, 5],
            dailyStartTime: '22:00',
            dailyEndTime: '02:00',
            allBranches: false,
            branchIds: [3],
            targetMenuItemIds: [],
            targetCategoryIds: [],
            comboItems: [{ menuItemId: 1, quantity: 1 }, { menuItemId: 2, quantity: 1 }],
            buyQuantity: null,
            payQuantity: null,
        });
        // Every day selected = no weekday restriction; all branches clears the list.
        expect(promotionRulesPayload({ ...EMPTY_PROMOTION_RULES, weekdays: [1, 2, 3, 4, 5, 6, 7], branchIds: [3] }))
            .toMatchObject({ weekdays: null, branchIds: [], scope: 'ORDER' });
    });

    it('round-trips an API promotion into the form', () => {
        expect(promotionRulesForm({
            type: 'BUY_X_GET_Y', value: 0, scope: 'ITEMS', buyQuantity: 3, payQuantity: 2, targetCategoryIds: [2],
            weekdays: [1, 2], dailyStartTime: '17:00', dailyEndTime: '19:00', allBranches: false, branchIds: [1],
        })).toMatchObject({ type: 'BUY_X_GET_Y', scope: 'ITEMS', buyQuantity: '3', payQuantity: '2', targetCategoryIds: [2], weekdays: [1, 2], allBranches: false, branchIds: [1] });
    });

    it('previews against open-order lines (non-voided) plus the cart', () => {
        expect(promotionPreviewItems(
            [{ menuItemId: 2, quantity: 1, price: 200, modifiers: [{ price: 20 }] }],
            [{ menuItemId: 1, quantity: 2, price: '55.00' }, { menuItemId: 3, quantity: 0, price: 10 }],
        )).toEqual([
            { menuItemId: 1, quantity: 2, unitPrice: 55, modifierUnitPrice: 0 },
            { menuItemId: 2, quantity: 1, unitPrice: 200, modifierUnitPrice: 20 },
        ]);
    });
});
