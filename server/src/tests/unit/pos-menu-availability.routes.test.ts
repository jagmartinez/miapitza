import { afterEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import posRoutes from '../../routes/pos.routes';
import { MenuAvailabilityService } from '../../services/menu-availability.service';

// La primera capa del router es el middleware JWT: se reemplaza por un doble que lee el usuario de un header.
const authLayer = (posRoutes as unknown as { stack: { handle: unknown }[] }).stack[0];
authLayer.handle = (req: { headers: Record<string, string>; user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const raw = req.headers['x-test-user'];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    return next();
};

const app = express();
app.use('/api/v1/pos', posRoutes);

const cajero = JSON.stringify({ id: 2, companyId: 5, role: 'CAJERO', roles: ['CAJERO'], branchId: 9 });

describe('GET /api/v1/pos/menu-availability', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('requires authentication', async () => {
        await request(app).get('/api/v1/pos/menu-availability?warehouseId=1').expect(401);
    });

    it('rejects a missing or invalid warehouseId', async () => {
        const spy = jest.spyOn(MenuAvailabilityService, 'forWarehouse');
        await request(app).get('/api/v1/pos/menu-availability').set('x-test-user', cajero).expect(400);
        await request(app).get('/api/v1/pos/menu-availability?warehouseId=abc').set('x-test-user', cajero).expect(400);
        expect(spy).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the user company and branch', async () => {
        const spy = jest.spyOn(MenuAvailabilityService, 'forWarehouse').mockResolvedValue({
            warehouseId: 4,
            items: [{ menuItemId: 1, status: 'LOW', portions: 2 }],
        });
        const res = await request(app).get('/api/v1/pos/menu-availability?warehouseId=4').set('x-test-user', cajero).expect(200);
        expect(res.body).toEqual({ success: true, data: { warehouseId: 4, items: [{ menuItemId: 1, status: 'LOW', portions: 2 }] } });
        expect(spy).toHaveBeenCalledWith(expect.anything(), { companyId: 5, warehouseId: 4, branchId: 9 });
    });

    it('returns 404 when the warehouse is not visible to the user', async () => {
        jest.spyOn(MenuAvailabilityService, 'forWarehouse').mockResolvedValue(null);
        await request(app).get('/api/v1/pos/menu-availability?warehouseId=4').set('x-test-user', cajero).expect(404);
    });
});
