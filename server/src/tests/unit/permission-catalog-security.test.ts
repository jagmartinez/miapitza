import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PermissionService } from '../../services/permission.service';

const actor = { userId: 7, companyId: 3 };

describe('permission catalog security invariants', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does not allow renaming a durable guard identifier', async () => {
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue({
            id: 4,
            name: 'payments.reverse',
            description: 'Revertir pagos',
        } as never);

        await expect(PermissionService.update(4, {
            name: 'payments.reverse.disabled',
            description: 'renamed',
        }, actor)).rejects.toThrow(/inmutable/i);
    });

    it('does not delete a definition and reactivate legacy role fallback', async () => {
        await expect(PermissionService.delete(4)).rejects.toThrow(/durables/i);
    });

    it('validates names as stable module.action identifiers', async () => {
        await expect(PermissionService.create({ name: 'ADMIN' }, actor)).rejects.toThrow(/modulo\.accion/i);
    });
});
