import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { CashArqueoService } from '../../services/cash-arqueo.service';
import { SettingsScopeService } from '../../services/settings-scope.service';

afterEach(() => { jest.restoreAllMocks(); });

describe('scoped settings consumers', () => {
    it('cash arqueo uses the tolerance of the shift branch', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({ cashRegister: { branchId: 7 } } as never);
        const getNumber = jest.spyOn(SettingsScopeService, 'getNumber').mockResolvedValue(5);

        await expect(CashArqueoService.resolveTolerance(11, 1)).resolves.toBe(5);
        expect(getNumber).toHaveBeenCalledWith(1, 7, 'cash_reconciliation_tolerance');
    });

    it('kds timing uses the branch thresholds when consistent', async () => {
        jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) =>
            key === 'kds_warning_minutes' ? 4 : 12) as never);
        await expect(SettingsScopeService.getKdsTiming(1, 7)).resolves.toEqual({ warningMinutes: 4, urgentMinutes: 12 });
    });
});
