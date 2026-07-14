import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { CateringCashLedgerAuditService } from '../../services/catering-cash-ledger-audit.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('CateringCashLedgerAuditService', () => {
    it('fails the gate for legacy cash payments without their immutable cash entries', async () => {
        jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([
            { id: 10, cateringEventId: 5, amount: 50, status: 'ACTIVE', event: { companyId: 1, branchId: 2 } },
            { id: 11, cateringEventId: 6, amount: 25, status: 'REVERSED', event: { companyId: 1, branchId: 2 } }
        ] as never);
        jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([
            {
                id: 1, type: 'IN', amount: 25, reference: 'CAT-PAY-11',
                shift: { companyId: 1, cashRegister: { branchId: 2 } }
            }
        ] as never);

        const anomalies = await CateringCashLedgerAuditService.audit(1);
        expect(anomalies.map((anomaly) => [anomaly.paymentId, anomaly.code]))
            .toEqual([[10, 'MISSING_IN'], [11, 'MISSING_OUT']]);
        await expect(CateringCashLedgerAuditService.assertClean(1)).rejects.toThrow(/Remediate manually/);
    });

    it('accepts one scoped, amount-matched entry and compensation per reversed payment', async () => {
        jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([
            { id: 11, cateringEventId: 6, amount: 25, status: 'REVERSED', event: { companyId: 1, branchId: 2 } }
        ] as never);
        jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([
            { id: 1, type: 'IN', amount: 25, reference: 'CAT-PAY-11', shift: { companyId: 1, cashRegister: { branchId: 2 } } },
            { id: 2, type: 'OUT', amount: 25, reference: 'REV-CAT-PAY-11', shift: { companyId: 1, cashRegister: { branchId: 2 } } }
        ] as never);

        await expect(CateringCashLedgerAuditService.assertClean(1)).resolves.toBeUndefined();
    });

    it('does not hide a duplicate or wrong-direction entry behind a valid reference', async () => {
        jest.spyOn(prisma.cateringPayment, 'findMany').mockResolvedValue([
            { id: 12, cateringEventId: 7, amount: 30, status: 'ACTIVE', event: { companyId: 1, branchId: 2 } }
        ] as never);
        jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([
            { id: 1, type: 'IN', amount: 30, reference: 'CAT-PAY-12', shift: { companyId: 1, cashRegister: { branchId: 2 } } },
            { id: 2, type: 'OUT', amount: 30, reference: 'CAT-PAY-12', shift: { companyId: 9, cashRegister: { branchId: 8 } } }
        ] as never);

        await expect(CateringCashLedgerAuditService.audit(1)).resolves.toEqual([
            expect.objectContaining({ paymentId: 12, code: 'DUPLICATE_IN' })
        ]);
    });
});
