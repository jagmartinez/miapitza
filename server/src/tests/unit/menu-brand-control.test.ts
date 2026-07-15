import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { MenuBrandService } from '../../services/menu-brand.service';

describe('MenuBrand control and audit', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('validates brand fields before writing', async () => {
        await expect(MenuBrandService.create(1, { name: 'Pizza', color: 'red' }, 7)).rejects.toThrow(/hexadecimal/i);
        await expect(MenuBrandService.update(2, 1, { sortOrder: 1.5 }, 7)).rejects.toThrow(/entero/i);
    });

    it('creates the brand and its audit record in one transaction', async () => {
        const tx = {
            menuBrand: {
                create: jest.fn().mockResolvedValue({
                    id: 12, companyId: 1, name: 'Pizza', color: '#112233', sortOrder: 2, active: true,
                } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 90 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(((callback: unknown) =>
            (callback as (client: typeof tx) => Promise<unknown>)(tx)) as never);

        await MenuBrandService.create(1, { name: ' Pizza ', color: '#112233', sortOrder: 2 }, 7);

        expect(tx.menuBrand.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ name: 'Pizza', color: '#112233', sortOrder: 2 }),
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ userId: 7, entityType: 'MenuBrand', action: 'CREATE' }),
        }));
    });
});
