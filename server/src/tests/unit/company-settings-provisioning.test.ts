import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CompanyService } from '../../services/company.service';
import { DEFAULT_COMPANY_SETTINGS, SettingService } from '../../services/setting.service';

describe('company settings provisioning', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('creates a company and its defaults in the same transaction', async () => {
        const tx = {
            company: {
                create: jest.fn().mockResolvedValue({ id: 8, name: 'Nueva Empresa' } as never)
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never
        );
        const ensureDefaults = jest.spyOn(SettingService, 'ensureDefaultsForCompany')
            .mockResolvedValue({ count: Object.keys(DEFAULT_COMPANY_SETTINGS).length } as never);

        const company = await CompanyService.create({ name: 'Nueva Empresa' });

        expect(company).toEqual({ id: 8, name: 'Nueva Empresa' });
        expect(ensureDefaults).toHaveBeenCalledWith(8, tx as never);
    });

    it('backfills missing defaults for every existing company at startup', async () => {
        jest.spyOn(prisma.company, 'findMany').mockResolvedValue([{ id: 1 }, { id: 4 }] as never);
        const ensureDefaults = jest.spyOn(SettingService, 'ensureDefaultsForCompany')
            .mockResolvedValue({ count: 0 } as never);

        await SettingService.initializeDefaults();

        expect(ensureDefaults).toHaveBeenNthCalledWith(1, 1);
        expect(ensureDefaults).toHaveBeenNthCalledWith(2, 4);
    });

    it('uses tenant id and tenant-prefixed names when reading settings', async () => {
        const findMany = jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ ruc: null } as never);

        await SettingService.getAll(7);

        expect(findMany).toHaveBeenCalledWith({
            where: {
                companyId: 7,
                name: { startsWith: '7_' }
            }
        });
    });

    it('inserts defaults idempotently without overwriting configured values', async () => {
        const createMany = jest.fn().mockResolvedValue({ count: 6 } as never);

        await SettingService.ensureDefaultsForCompany(3, { setting: { createMany } } as never);

        expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
            skipDuplicates: true,
            data: expect.arrayContaining([
                { companyId: 3, name: '3_currency', value: 'NIO' },
                { companyId: 3, name: '3_tax_rate', value: '15' }
            ])
        }));
    });
});
