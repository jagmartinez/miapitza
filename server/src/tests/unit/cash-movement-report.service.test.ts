import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    CashMovementReportService,
    classifyCashMovementReference,
    summarizeCashMovements
} from '../../services/cash-movement-report.service';

describe('cash movement report classification', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        ['IN', 'PAY-10', 'POS_SALE'],
        ['IN', 'CAT-PAY-20', 'CATERING_SALE'],
        ['OUT', 'REV-PAY-10', 'POS_PAYMENT_REVERSAL'],
        ['OUT', 'REV-CAT-PAY-20', 'CATERING_PAYMENT_REVERSAL'],
        ['OUT', 'CN-REF-NC-A-0001-PAY-10', 'CREDIT_NOTE_REFUND'],
        ['IN', null, 'MANUAL_INCOME'],
        ['OUT', null, 'MANUAL_OUTFLOW'],
        ['IN', 'LEGACY-IN-1', 'UNCLASSIFIED_INCOME'],
        ['OUT', 'LEGACY-OUT-1', 'UNCLASSIFIED_OUTFLOW'],
        ['OUT', 'PAY-10', 'UNCLASSIFIED_OUTFLOW'],
        ['OUT', 'CAT-PAY-20', 'UNCLASSIFIED_OUTFLOW'],
        ['IN', 'REV-PAY-10', 'UNCLASSIFIED_INCOME'],
        ['IN', 'REV-CAT-PAY-20', 'UNCLASSIFIED_INCOME'],
        ['IN', 'CN-REF-NC-A-0001-PAY-10', 'UNCLASSIFIED_INCOME']
    ] as const)('classifies %s %s as %s', (type, reference, category) => {
        expect(classifyCashMovementReference(type, reference).category).toBe(category);
    });

    it('separates POS/Catering cash sales, refunds and other movements in integer cents', () => {
        const result = summarizeCashMovements([
            { id: 1, type: 'IN', amount: 100.10, reference: 'PAY-1' },
            { id: 2, type: 'IN', amount: 20.20, reference: 'CAT-PAY-2' },
            { id: 3, type: 'IN', amount: 0.10, reference: null },
            { id: 4, type: 'IN', amount: 0.20, reference: 'LEGACY-IN-4' },
            { id: 5, type: 'OUT', amount: 5.05, reference: 'REV-PAY-1' },
            { id: 6, type: 'OUT', amount: 1.01, reference: 'CN-REF-NC-1-PAY-1' },
            { id: 7, type: 'OUT', amount: 0.30, reference: 'EXP-7' }
        ]);

        expect(result).toEqual({
            totalIn: 120.60,
            totalOut: 6.36,
            grossSalesCash: 120.30,
            cashRefunds: 6.06,
            totalSalesCash: 114.24,
            otherIncome: 0.30,
            otherOutflows: 0.30
        });
    });

    it('resolves real payment methods with tenant and branch scope and leaves manual/unknown origins explicit', async () => {
        const paymentFindMany = jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([{
            id: 10,
            methodType: 'CASH',
            paymentMethod: { id: 3, name: 'Efectivo córdobas' }
        }] as never);
        const cateringFindMany = jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([{
            id: 20,
            methodType: 'CASH',
            paymentMethod: { id: 4, name: 'Efectivo Catering' }
        }] as never);

        const movements = await CashMovementReportService.enrichForReport([
            { id: 1, type: 'IN' as const, amount: 10, reference: 'PAY-10' },
            { id: 2, type: 'OUT' as const, amount: 4, reference: 'REV-CAT-PAY-20' },
            { id: 3, type: 'IN' as const, amount: 1, reference: null },
            { id: 4, type: 'OUT' as const, amount: 2, reference: 'LEGACY-OUT-4' },
            { id: 5, type: 'OUT' as const, amount: 3, reference: 'REV-PAY-999' }
        ], 7, 12);

        expect(paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: { in: [10, 999] },
                order: { companyId: 7, branchId: 12 }
            }
        }));
        expect(cateringFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: { in: [20] },
                event: { companyId: 7, branchId: 12 }
            }
        }));
        expect(movements[0]).toMatchObject({
            category: 'POS_SALE',
            paymentMethod: {
                id: 3,
                name: 'Efectivo córdobas',
                type: 'CASH',
                source: 'PAYMENT',
                nameSource: 'CURRENT_PAYMENT_METHOD_CATALOG'
            }
        });
        expect(movements[1]).toMatchObject({
            category: 'CATERING_PAYMENT_REVERSAL',
            paymentMethod: { id: 4, type: 'CASH', source: 'CATERING_PAYMENT' }
        });
        expect(movements[2]).toMatchObject({
            category: 'MANUAL_INCOME',
            paymentMethod: { name: 'Movimiento manual de caja', type: null }
        });
        expect(movements[3]).toMatchObject({
            category: 'UNCLASSIFIED_OUTFLOW',
            paymentMethod: { name: 'Movimiento no clasificado', type: null }
        });
        expect(movements[4]).toMatchObject({
            category: 'POS_PAYMENT_REVERSAL',
            paymentMethod: { name: 'Referencia de pago no conciliada', source: 'UNRESOLVED_REFERENCE' }
        });
    });
});
