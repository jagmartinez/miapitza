import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BiometricService } from '../../services/hr-biometric.service';
import prisma from '../../utils/prisma';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('BiometricService.runScheduledMaintenance', () => {
    it('discovers tenants with due work and selects an actor by permission, not SUPERADMIN', async () => {
        jest.spyOn(prisma.biometricProfile, 'findMany').mockResolvedValue([{ companyId: 4 }] as never);
        jest.spyOn(prisma.biometricPurgeRequest, 'findMany').mockResolvedValue([
            { companyId: 4 },
            { companyId: 8 },
        ] as never);
        const actors = jest.spyOn(prisma.user, 'findFirst')
            .mockResolvedValueOnce({ id: 41 } as never)
            .mockResolvedValueOnce(null);
        const maintenance = jest.spyOn(BiometricService, 'runRetentionMaintenance')
            .mockResolvedValue({ expiredProfilesRevoked: 1, providerTemplatesPurged: 0, pendingChecked: 0 });
        const now = new Date('2026-07-22T12:00:00.000Z');

        const results = await BiometricService.runScheduledMaintenance(now);

        expect(maintenance).toHaveBeenCalledTimes(1);
        expect(maintenance.mock.calls[0][0]).toBe(4);
        expect(maintenance.mock.calls[0][1]).toBe(41);
        expect(results).toEqual([
            { companyId: 4, ok: true },
            {
                companyId: 8,
                ok: false,
                error: 'No active user has hr.biometric.manage for maintenance audit',
            },
        ]);
        const actorWhere = actors.mock.calls[0][0]?.where;
        expect(JSON.stringify(actorWhere)).toContain('hr.biometric.manage');
        expect(JSON.stringify(actorWhere)).not.toContain('SUPERADMIN');
    });
});
