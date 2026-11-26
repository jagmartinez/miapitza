import { describe, expect, it } from 'vitest';
import cashShiftSource from './CashShift.tsx?raw';
import cashShiftReportSource from './cashShiftReport.ts?raw';

const source = `${cashShiftSource}\n${cashShiftReportSource}`;

describe('cash shift report presentation contract', () => {
    it('defines other income without duplicating POS or Catering cash sales', () => {
        expect(cashShiftSource).toContain('summary?.otherIncome');
        expect(cashShiftReportSource).toContain('amounts.otherIncome');
        expect(source).not.toContain('Otros Ingresos:</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(amounts.totalIn)}');
        expect(source).toContain('No incluyen cobros POS');
        expect(source).toContain('Ventas netas efectivo');
        expect(cashShiftSource).toContain('summary?.otherOutflows');
    });

    it('shows payment method or explicit movement origin in both screen and printed detail', () => {
        expect(source.match(/Forma de pago \/ origen/g)?.length).toBe(2);
        expect(cashShiftSource).toContain('getMovementPaymentOrigin(m)');
        expect(cashShiftReportSource).toContain('getMovementPaymentOrigin(m)');
        expect(cashShiftReportSource).toContain('Movimiento no clasificado');
        expect(cashShiftReportSource).toContain('getMovementCategoryLabel');
        expect(cashShiftReportSource).toContain('getMovementAuditLabel');
        expect(cashShiftReportSource).toContain("CASH: 'Efectivo'");
    });
});
