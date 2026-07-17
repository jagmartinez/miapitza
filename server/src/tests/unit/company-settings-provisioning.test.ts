import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CompanyService } from '../../services/company.service';
import { CompanyProvisioningService } from '../../services/company-provisioning.service';
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
        // Create-company cases stub provisioning; real tx.permission/role path is covered below.
        const provisionRoles = jest.spyOn(CompanyProvisioningService, 'provisionTenantRoles')
            .mockResolvedValue(undefined);

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
        expect(provisionRoles).toHaveBeenCalledWith(8, tx as never);
    });

    it('stores the non-withholding reason in the company fiscal profile', async () => {
        const tx = { company: { create: jest.fn().mockResolvedValue({ id: 9, name: 'Cuota Fija' } as never) } };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never
        );
        jest.spyOn(SettingService, 'ensureDefaultsForCompany').mockResolvedValue({ count: 0 } as never);
        jest.spyOn(CompanyProvisioningService, 'provisionTenantRoles').mockResolvedValue(undefined);

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

    it('provisions tenant roles without SUPERADMIN using tx.permission/role', async () => {
        const findMany = jest.fn().mockResolvedValue([
            { id: 1, name: 'view_orders' },
            { id: 2, name: 'view_menu' },
            { id: 3, name: 'hr.schedule.manage' },
            { id: 4, name: 'hr.payroll.approve' },
            { id: 5, name: 'hr.benefits.approve' },
        ] as never);
        const roleCreate = jest.fn().mockResolvedValue({ id: 100 } as never);
        const tx = {
            permission: { findMany },
            role: { create: roleCreate },
        };

        await CompanyProvisioningService.provisionTenantRoles(12, tx as never);

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { name: { in: expect.any(Array) } },
        }));
        expect(roleCreate).toHaveBeenCalledTimes(7);
        const createdNames = roleCreate.mock.calls.map(
            (call) => (call[0] as { data: { name: string } }).data.name
        );
        expect(createdNames).toEqual(expect.arrayContaining([
            'ADMIN', 'MESERO', 'HOST', 'COCINA', 'CHEF', 'BODEGA', 'CAJERO',
        ]));
        expect(createdNames).not.toContain('SUPERADMIN');
        expect(roleCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 12 }),
        }));
        const adminCall = roleCreate.mock.calls.find(
            (call) => (call[0] as { data: { name: string } }).data.name === 'ADMIN',
        );
        expect(adminCall?.[0]).toEqual(expect.objectContaining({
            data: expect.objectContaining({
                permissions: { connect: expect.arrayContaining([{ id: 3 }, { id: 4 }, { id: 5 }]) },
            }),
        }));
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

    it('aliases canonical tax_rate onto taxRate for POS/Settings consumers', async () => {
        jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([
            { name: '7_tax_rate', value: '15' },
            { name: '7_restaurant_name', value: 'Demo' }
        ] as never);
        jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ ruc: null } as never);

        const settings = await SettingService.getAll(7);

        expect(settings.tax_rate).toBe('15');
        expect(settings.taxRate).toBe('15');
        expect(settings.restaurant_name).toBe('Demo');
        expect(settings.companyName).toBe('Demo');
    });

    it('writes taxRate updates to canonical tax_rate and deletes the legacy key', async () => {
        const findFirst = jest.fn().mockResolvedValue(null as never);
        const create = jest.fn().mockResolvedValue({} as never);
        const deleteMany = jest.fn().mockResolvedValue({ count: 1 } as never);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: {
                setting: { findFirst: typeof findFirst; create: typeof create; deleteMany: typeof deleteMany };
            }) => Promise<unknown>) => callback({ setting: { findFirst, create, deleteMany } })) as never
        );
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ tax_rate: '15', taxRate: '15' } as never);

        await SettingService.update(7, { taxRate: '15' });

        expect(create).toHaveBeenCalledWith({
            data: { name: '7_tax_rate', value: '15', companyId: 7 }
        });
        expect(deleteMany).toHaveBeenCalledWith({
            where: { companyId: 7, name: '7_taxRate' }
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
