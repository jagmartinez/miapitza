import type { ShiftReport } from '../../data/cashTypes';

/** A closed shift with a SOBRANTE of C$ 5.00, dollars counted and a closing note. */
export function reportOf(over: { header?: ShiftReport['header']; shift?: Partial<ShiftReport['shift']>; amounts?: ShiftReport['amounts'] } = {}): ShiftReport {
    return {
        shift: { id: 42, cashRegister: 'Caja 1', user: 'Carla Cajera', startDate: '2026-11-20T14:00:00.000Z', endDate: '2026-11-21T00:10:00.000Z', closedBy: { id: 5, name: 'Carla Cajera' }, forceClosed: false, closingExchangeRate: 36.5, status: 'CERRADO', notes: 'Sobro un billete de 5 en la caja.', ...over.shift },
        header: over.header ?? { companyName: 'Mia Pitza S.A.', ruc: 'J0310000000001', branchName: 'Sucursal Centro', branchAddress: 'Del parque 2c al sur', branchPhone: '2222-0000' },
        amounts: { startAmount: 500, expectedEndAmount: 2420.5, actualEndAmount: 2425.5, difference: 5, totalIn: 1300, totalOut: 100, grossSalesCash: 1200, cashRefunds: 0, totalSalesCash: 1200, otherIncome: 100, otherOutflows: 100, ...over.amounts },
        movements: { in: [], out: [] },
        counts: {
            bills: [{ denomination: 1000, count: 1 }, { denomination: 500, count: 1 }, { denomination: 100, count: 2 }],
            coins: [{ denomination: 5, count: 2 }],
            usdBills: [{ denomination: 20, count: 2 }, { denomination: 1, count: 3 }],
        },
        reconciliation: { isBalanced: false, surplus: 5, deficit: 0 },
        report: { title: 'REPORTE DE CIERRE DE CAJA', generatedAt: '2026-11-21T00:11:00.000Z', summary: '' },
    };
}

export const SALES = { cash: 1200, card: 600, transfer: 200, paymentCount: 14 };
