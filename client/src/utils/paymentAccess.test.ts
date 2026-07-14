import { describe, expect, it } from 'vitest';
import { hasUsableCashShift, isCashPaymentMethodType } from './paymentAccess';

describe('payment access contract', () => {
    it('uses the persisted method type and ignores the display label', () => {
        expect(isCashPaymentMethodType('CASH')).toBe(true);
        expect(isCashPaymentMethodType('CARD')).toBe(false);
        expect(isCashPaymentMethodType('OTHER')).toBe(false);
        expect(isCashPaymentMethodType(undefined)).toBe(false);
    });

    it('requires a current shift from the order branch for cash', () => {
        const status = {
            hasActiveShift: true,
            requiresClose: false,
            shift: { cashRegister: { branch: { id: 4 } } },
        };
        expect(hasUsableCashShift(status, 4)).toBe(true);
        expect(hasUsableCashShift(status, 5)).toBe(false);
        expect(hasUsableCashShift({ ...status, requiresClose: true }, 4)).toBe(false);
        expect(hasUsableCashShift({ ...status, hasActiveShift: false }, 4)).toBe(false);
    });
});
