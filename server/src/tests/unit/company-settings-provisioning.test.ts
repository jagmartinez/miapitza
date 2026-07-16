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

        const company = await CompanyService.create({
            name: 'Nueva Empresa',
            payrollTaxRegime: 'GENERAL',
            payrollIncomeTaxWithholding: true,
            payrollTaxRegimeReference: 'Constancia DGI 2026',
        });

        expect(company).toEqual({ id: 8, name: 'Nueva Empresa' });
        expect(tx.company.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            payrollTaxRegime: 'GENERAL',
            payrollIncomeTaxWithholding: true,
            payrollTaxRegimeReference: 'Constancia DGI 2026',
            payrollIncomeTaxException: null,
            payrollTaxProfileReady: true,
        }) });
        expect(ensureDefaults).toHaveBeenCalledWith(8, tx as never);
    });

    it('stores the non-withholding reason in the company fiscal profile', async () => {
        const tx = { company: { create: jest.fn().mockResolvedValue({ id: 9, name: 'Cuota Fija' } as never) } };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never
        );
        jest.spyOn(SettingService, 'ensureDefaultsForCompany').mockResolvedValue({ count: 0 } as never);

        await CompanyService.create({
            name: 'Cuota Fija',
            payrollTaxRegime: 'SIMPLIFIED_FIXED_QUOTA',
            payrollTaxRegimeReference: 'Constancia DGI 2026',
            payrollIncomeTaxWithholding: false,
            payrollIncomeTaxException: 'No retiene por resolución DGI',
        });

        expect(tx.company.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            payrollTaxRegime: 'SIMPLIFIED_FIXED_QUOTA',
            payrollIncomeTaxWithholding: false,
            payrollIncomeTaxException: 'No retiene por resolución DGI',
        }) });
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
