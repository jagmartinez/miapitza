import type { CashApi } from '../../data/cashApi';
import type { CashRegisterRow, ShiftSummary } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import { session as baseSession } from '../../test/helpers';

export function cashSession(role: 'CAJERO' | 'ADMIN' | 'SUPERADMIN' | 'MESERO' = 'CAJERO'): Session {
    return { ...baseSession, user: { ...baseSession.user, id: 5, name: 'Carla Cajera', role: { id: 2, name: role }, roles: [role], permissions: [] } };
}

export const REGISTERS: CashRegisterRow[] = [
    { id: 1, name: 'Caja 1', branchId: 1, status: 'CLOSED', activeShift: null },
    { id: 2, name: 'Caja 2', branchId: 1, status: 'OPEN', activeShift: { id: 90, startDate: '2026-11-20T14:00:00.000Z', userId: 9, user: { id: 9, name: 'Luis Gomez' } } },
];

export const SHIFT = { id: 42, cashRegisterId: 1, userId: 5, startDate: '2026-11-20T14:00:00.000Z', endDate: null, startAmount: 500, cashRegister: { id: 1, name: 'Caja 1' }, user: { id: 5, name: 'Carla Cajera' } };

export function summaryOf(over: Partial<ShiftSummary['summary']> = {}, movements: ShiftSummary['shift']['movements'] = []): ShiftSummary {
    return {
        shift: { ...SHIFT, movements },
        summary: { startAmount: 500, totalIn: 1300, totalOut: 100, grossSalesCash: 1200, cashRefunds: 0, totalSalesCash: 1200, otherIncome: 100, otherOutflows: 100, movementCount: movements?.length ?? 0, ...over },
    };
}

/** Blind (open shift, CAJERO): the server omits expected and difference. */
export const BLIND = summaryOf();
export const FULL = summaryOf({ expectedBalance: 1700, expectedAmount: 1700, actualBalance: null, difference: null, salesByMethod: { cash: 1200, card: 600, transfer: 200, paymentCount: 14 } });

export type FakeCash = { [K in keyof CashApi]: CashApi[K] & ReturnType<typeof vi.fn> };

export function makeCash(over: Partial<Record<keyof CashApi, unknown>> = {}): FakeCash {
    return {
        registers: vi.fn().mockResolvedValue(REGISTERS),
        activeStatus: vi.fn().mockResolvedValue({ hasActiveShift: false, shift: null, requiresClose: false, message: null }),
        suggestedFloat: vi.fn().mockResolvedValue({ suggested: 800, fromShiftId: 30 }),
        summary: vi.fn().mockResolvedValue(BLIND),
        report: vi.fn(),
        history: vi.fn(),
        settings: vi.fn().mockResolvedValue({ exchangeRateUsd: 36.5, tolerance: 1 }),
        openShift: vi.fn().mockResolvedValue(SHIFT),
        addMovement: vi.fn().mockResolvedValue({ id: 1 }),
        count: vi.fn(),
        previewClose: vi.fn(),
        close: vi.fn(),
        ...over,
    } as unknown as FakeCash;
}
