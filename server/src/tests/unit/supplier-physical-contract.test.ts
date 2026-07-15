import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { SupplierService } from '../../services/supplier.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Supplier physical catalog contract', () => {
    it('persists the supply type selected by the supplier screen', async () => {
        const create = jest.spyOn(prisma.supplier, 'create').mockResolvedValue({ id: 5 } as never);

        await SupplierService.create(1, { name: 'Proveedor', supplyType: '  Carnes  ' });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 1, supplyType: 'Carnes' })
        }));
    });

    it('can explicitly clear a previously assigned supply type', async () => {
        const update = jest.spyOn(prisma.supplier, 'update').mockResolvedValue({ id: 5 } as never);

        await SupplierService.update(5, 1, { supplyType: '   ' });

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ supplyType: null })
        }));
    });
});
