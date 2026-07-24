import { describe, expect, it } from 'vitest';
import cashShiftSource from './CashShift.tsx?raw';

describe('cash shift report presentation contract', () => {
    it('defines other income without duplicating POS or Catering cash sales', () => {
        expect(cashShiftSource).toContain('summary?.otherIncome');
        expect(cashShiftSource).toContain('amounts.otherIncome');
        expect(cashShiftSource).not.toContain('Otros Ingresos:</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(amounts.totalIn)}');
        expect(cashShiftSource).toContain('No incluyen cobros POS ni Catering');
        expect(cashShiftSource).toContain('Ventas netas efectivo');
        expect(cashShiftSource).toContain('summary?.otherOutflows');
    });

    it('shows payment method or explicit movement origin in both screen and printed detail', () => {
        expect(cashShiftSource.match(/Forma de pago \/ origen/g)?.length).toBe(2);
        expect(cashShiftSource).toContain('getMovementPaymentOrigin(mov)');
        expect(cashShiftSource).toContain('getMovementPaymentOrigin(m)');
        expect(cashShiftSource).toContain('Movimiento no clasificado');
        expect(cashShiftSource).toContain('getMovementCategoryLabel');
        expect(cashShiftSource).toContain('getMovementAuditLabel');
        expect(cashShiftSource).toContain("CASH: 'Efectivo'");
    });
});
