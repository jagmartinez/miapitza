import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ExportController } from '../../controllers/export.controller';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { OrderService } from '../../services/order.service';

function responseDouble() {
    const response = {
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
        status: jest.fn(),
    };
    response.status.mockReturnValue(response as never);
    return response;
}

const request = {
    user: { companyId: 1, timezone: 'America/Managua' },
    query: {},
} as never;

afterEach(() => {
    jest.restoreAllMocks();
});

describe('CSV export integrity', () => {
    it('walks every sales page instead of silently stopping at the service cap', async () => {
        const row = (id: number) => ({
            id,
            createdAt: new Date('2026-07-16T12:00:00.000Z'),
            status: 'DELIVERED',
            customerName: null,
            tax: 15,
            total: 115,
            table: null,
            user: { name: 'Caja' },
            items: [{ subtotal: 100 }],
            payments: [],
        });
        const getAll = jest.spyOn(OrderService, 'getAll')
            .mockResolvedValueOnce({ data: [row(1)], pagination: { page: 1, limit: 200, total: 2, totalPages: 2 } } as never)
            .mockResolvedValueOnce({ data: [row(2)], pagination: { page: 2, limit: 200, total: 2, totalPages: 2 } } as never);
        const res = responseDouble();

        await ExportController.exportSales(request, res as never);

        expect(getAll).toHaveBeenCalledTimes(2);
        expect(getAll).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ page: 2, limit: 200 }));
        expect(String(res.send.mock.calls[0][0])).toContain('\n1,');
        expect(String(res.send.mock.calls[0][0])).toContain('\n2,');
    });

    it('fails closed when a sales amount is absent instead of exporting zero', async () => {
        jest.spyOn(OrderService, 'getAll').mockResolvedValue({
            data: [{
                id: 3,
                createdAt: new Date('2026-07-16T12:00:00.000Z'),
                status: 'DELIVERED',
                tax: null,
                total: 100,
                table: null,
                user: null,
                items: [{ subtotal: 100 }],
                payments: [],
            }],
            pagination: { page: 1, limit: 200, total: 1, totalPages: 1 },
        } as never);
        const res = responseDouble();

        await ExportController.exportSales(request, res as never);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/impuesto ausente/i) }));
        expect(res.send).not.toHaveBeenCalled();
    });

    it('exports explicit N/D for an inventory movement whose historical cost is unknown', async () => {
        jest.spyOn(InventoryMovementService, 'getAll').mockResolvedValue([{
            id: 7,
            createdAt: new Date('2026-07-16T12:00:00.000Z'),
            product: { name: 'Harina', unit: 'kg' },
            warehouse: { name: 'Central' },
            user: null,
            type: 'OUT',
            quantity: 2,
            unitCost: null,
            totalCost: null,
            reason: 'Legado',
        }] as never);
        const res = responseDouble();

        await ExportController.exportInventory(request, res as never);

        const csv = String(res.send.mock.calls[0][0]);
        expect(csv).toContain('Costo Unitario');
        expect(csv).toContain('N/D');
    });
});
