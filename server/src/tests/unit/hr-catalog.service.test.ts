import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { HrCatalogService } from '../../services/hr.service';

describe('HR catalog writes', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('rejects a non-boolean active flag instead of coercing a false string to true', async () => {
        jest.spyOn(prisma.department, 'findFirst').mockResolvedValue({
            id: 12,
            companyId: 4,
            name: 'Operaciones',
            code: 'OPS',
            description: null,
            active: true,
            createdAt: new Date('2026-07-25T00:00:00.000Z'),
            updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValue({
            id: 12,
            active: true,
        } as never);

        await expect(HrCatalogService.update(
            'department',
            12,
            4,
            { active: 'false' } as never,
            9,
        )).rejects.toThrow('active debe ser booleano');

        expect(transaction).not.toHaveBeenCalled();
    });
});
