import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CashArqueoService } from '../../services/cash-arqueo.service';
import { SettingService } from '../../services/setting.service';

describe('CashArqueoService.generateShiftReport carries note, sales by method, discounts and tips', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    const inWindow = new Date('2026-11-20T20:00:00Z');
    const lastPayments = [
        { orderId: 1, _max: { createdAt: inWindow } },
        { orderId: 2, _max: { createdAt: inWindow } },
        { orderId: 3, _max: { createdAt: inWindow } }
    ];

    function arrange(status: 'CERRADO' | 'ABIERTO') {
        const endDate = status === 'CERRADO' ? new Date('2026-11-20T22:00:00Z') : null;
        jest.spyOn(CashArqueoService, 'getShiftDetails').mockResolvedValue({
            shift: { id: 9, cashRegister: 'Caja 1', user: 'Ana', startDate: new Date('2026-11-20T14:00:00Z'), endDate, status, notes: 'Sobro un billete' },
            amounts: { startAmount: 50, expectedEndAmount: 140, actualEndAmount: 145, difference: 5, totalSalesCash: 80, totalIn: 100, totalOut: 10 },
            movements: { in: [], out: [] },
            counts: { bills: [], coins: [], usdBills: [] },
            reconciliation: { isBalanced: false, surplus: 5, deficit: 0 }
        } as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            userId: 3,
            startDate: new Date('2026-11-20T14:00:00Z'),
            endDate,
            cashRegister: { branchId: 5, branch: { name: 'Centro', address: null, phone: null, company: { name: 'Mia Pitza', ruc: 'J1' } } }
        } as never);
        jest.spyOn(prisma.payment, 'groupBy').mockResolvedValue(lastPayments as never);
        return jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([
            { orderId: 1, methodType: 'CASH', amount: 80, order: { discount: 10, tipAmount: 5 } },
            { orderId: 2, methodType: 'CARD', amount: 30.25, order: { discount: 0, tipAmount: 3.5 } },
            { orderId: 2, methodType: 'CARD', amount: 30.25, order: { discount: 0, tipAmount: 3.5 } }, // second leg of the same order
            { orderId: 3, methodType: 'BANK_TRANSFER', amount: 20, order: { discount: 2.25, tipAmount: 0 } }
        ] as never);
    }

    it('adds the closing note, sales by method (shift window and branch) and discount and tip totals', async () => {
        const findMany = arrange('CERRADO');
        const report = await CashArqueoService.generateShiftReport(9, 2);

        expect(report.shift.notes).toBe('Sobro un billete');
        expect(report.salesByMethod).toEqual({ cash: 80, card: 60.5, transfer: 20, paymentCount: 3 });
        // each order counts once, even when its bill was split in several payments
        expect(report.discounts).toBe(12.25);
        expect(report.tips).toBe(8.5);
        const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({
            registeredById: 3,
            status: 'ACTIVE',
            createdAt: { gte: new Date('2026-11-20T14:00:00Z'), lt: new Date('2026-11-20T22:00:00Z') },
            order: { companyId: 2, branchId: 5 }
        });
        expect(report.header.companyName).toBe('Mia Pitza');
    });

    it('counts an order discount and tip once: in the shift that holds its LAST active payment', async () => {
        const findMany = arrange('CERRADO');
        findMany.mockResolvedValue([
            { orderId: 1, methodType: 'CASH', amount: 80, order: { discount: 10, tipAmount: 5 } },
            // order 4 was paid half in this shift and half in the next one: its discount and tip belong to the next shift
            { orderId: 4, methodType: 'CARD', amount: 50, order: { discount: 20, tipAmount: 7 } }
        ] as never);
        (prisma.payment.groupBy as jest.Mock).mockResolvedValue([
            { orderId: 1, _max: { createdAt: inWindow } },
            { orderId: 4, _max: { createdAt: new Date('2026-11-20T22:30:00Z') } }
        ] as never);
        const report = await CashArqueoService.generateShiftReport(9, 2);
        expect(report.discounts).toBe(10);
        expect(report.tips).toBe(5);
        // the money itself is still this shift's
        expect(report.salesByMethod).toEqual({ cash: 80, card: 50, transfer: 0, paymentCount: 2 });
        const where = ((prisma.payment.groupBy as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({ orderId: { in: [1, 4] }, status: 'ACTIVE' });

        // the next shift (window starts at 22:00) holds the last payment of order 4
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            userId: 3, startDate: new Date('2026-11-20T22:00:00Z'), endDate: null,
            cashRegister: { branchId: 5, branch: { name: 'Centro', address: null, phone: null, company: { name: 'Mia Pitza', ruc: 'J1' } } }
        } as never);
        findMany.mockResolvedValue([{ orderId: 4, methodType: 'CARD', amount: 50, order: { discount: 20, tipAmount: 7 } }] as never);
        const next = await CashArqueoService.generateShiftReport(10, 2);
        expect(next.discounts).toBe(20);
        expect(next.tips).toBe(7);
    });

    it('stays out of the blind redaction: sales are not blind data', async () => {
        arrange('ABIERTO');
        const report = await CashArqueoService.generateShiftReport(9, 2);
        expect(report.salesByMethod.card).toBe(60.5);
    });
});
