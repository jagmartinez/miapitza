import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ProductImportService } from '../../services/product-import.service';
import { CompanyService } from '../../services/company.service';
import { ModifierService } from '../../services/modifier.service';
import { SettingService } from '../../services/setting.service';
import { MenuItemService } from '../../services/menu-item.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

describe('catalog/admin hardening', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('product import confirm', () => {
        it('ignores a forged existingProductId and resolves updates by SKU inside the tenant', async () => {
            jest.spyOn(prisma.product, 'findMany').mockResolvedValue([] as never);
            const update = jest.fn();
            const create = jest.fn().mockResolvedValue({ id: 50, unit: 'kg' } as never);
            jest.spyOn(prisma, '$transaction').mockImplementation(
                (async (cb: (tx: unknown) => Promise<unknown>) => cb({ product: { update, create } })) as never
            );
            jest.spyOn(UnitConversionService, 'autoConfigureProduct').mockResolvedValue(true as never);

            const result = await ProductImportService.confirmImport(1, [{
                sku: 'SKU-1', name: 'Harina', unit: 'kg', cost: 3,
                isUpdate: true, existingProductId: 999, // product of another company
            }]);

            expect(update).not.toHaveBeenCalled();
            expect(create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ companyId: 1, sku: 'SKU-1' }),
            }));
            expect(result.created).toBe(1);
        });

        it('rejects a categoryId that does not belong to the company', async () => {
            jest.spyOn(prisma.category, 'findMany').mockResolvedValue([] as never);
            const tx = jest.spyOn(prisma, '$transaction');

            await expect(ProductImportService.confirmImport(1, [{
                sku: 'SKU-1', name: 'Harina', unit: 'kg', categoryId: 77, isUpdate: false,
            }])).rejects.toThrow('categoría no pertenece');
            expect(tx).not.toHaveBeenCalled();
        });

        it('rejects negative or non-numeric amounts before writing', async () => {
            await expect(ProductImportService.confirmImport(1, [{
                sku: 'SKU-1', name: 'Harina', unit: 'kg', cost: -5, isUpdate: false,
            }])).rejects.toThrow('Costo');
        });
    });

    describe('company logo', () => {
        it('refuses to point the logo at an arbitrary upload path', async () => {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([] as never),
                company: {
                    findUnique: jest.fn().mockResolvedValue({ id: 3, logo: '/uploads/logo-1-1.png' } as never),
                    update: jest.fn(),
                },
                auditLog: { create: jest.fn() },
            };
            jest.spyOn(prisma, '$transaction').mockImplementation(
                (async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)) as never
            );

            await expect(CompanyService.update(3, { logo: '/uploads/logo-2-2.png' }, 1))
                .rejects.toThrow('carga de archivos');
            expect(tx.company.update).not.toHaveBeenCalled();
        });

        it('rejects a logo on company creation', async () => {
            await expect(CompanyService.create({
                name: 'X', logo: '/uploads/logo-2-2.png', payrollTaxRegime: 'GENERAL',
                payrollIncomeTaxWithholding: true, payrollTaxRegimeReference: 'Ref 123',
            })).rejects.toThrow('carga de archivos');
        });
    });

    describe('modifier delete', () => {
        it('deactivates a modifier already sold instead of hard-deleting it', async () => {
            const tx = {
                modifier: {
                    findUnique: jest.fn().mockResolvedValue({ id: 5, modifierGroup: { companyId: 1 } } as never),
                    update: jest.fn().mockResolvedValue({ id: 5, active: false } as never),
                    delete: jest.fn(),
                },
                orderItemModifier: { findFirst: jest.fn().mockResolvedValue({ id: 10 } as never) },
            };
            jest.spyOn(prisma, '$transaction').mockImplementation(
                (async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)) as never
            );

            await ModifierService.deleteModifier(5, 1);

            expect(tx.modifier.delete).not.toHaveBeenCalled();
            expect(tx.modifier.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { active: false } });
        });
    });

    describe('settings allowlist', () => {
        it('rejects keys outside the writable allowlist', async () => {
            const tx = jest.spyOn(prisma, '$transaction');
            await expect(SettingService.update(1, { costing_method: 'FIFO' })).rejects.toThrow('no permitida');
            expect(tx).not.toHaveBeenCalled();
        });

        it('rejects non-string values', async () => {
            await expect(SettingService.update(1, { tipRate: 10 as unknown as string })).rejects.toThrow('texto');
        });
    });

    describe('menu item images', () => {
        it('rejects script and non-raster image URLs', async () => {
            const lookup = jest.spyOn(MenuItemService, 'getById');
            await expect(MenuItemService.addImage(1, 1, 'javascript:alert(1)')).rejects.toThrow('Imagen inválida');
            await expect(MenuItemService.addImage(1, 1, 'data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow('Imagen inválida');
            expect(lookup).not.toHaveBeenCalled();
        });
    });
});
