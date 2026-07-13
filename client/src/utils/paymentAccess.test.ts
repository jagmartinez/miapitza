import { describe, expect, it } from 'vitest';
import { hasUsableCashShift, isCashPaymentMethodName } from './paymentAccess';

describe('payment access contract', () => {
    it('uses the same exact cash names as the server ledger', () => {
        expect(isCashPaymentMethodName('Efectivo')).toBe(true);
        expect(isCashPaymentMethodName(' cash ')).toBe(true);
        expect(isCashPaymentMethodName('Tarjeta')).toBe(false);
        expect(isCashPaymentMethodName('Efectivo móvil')).toBe(false);
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
