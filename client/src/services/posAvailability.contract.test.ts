import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('./offlineManager', () => ({
    offlineManager: {
        enqueueRequest: vi.fn(),
        isOnline: vi.fn(() => true),
    },
}));

import api from './api';
import { loadMenuAvailability, posAvailabilityAPI } from './posAvailability';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('POS menu availability API contract', () => {
    it('calls the mounted read-only route with the warehouse id', async () => {
        const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: { warehouseId: 4, items: [] } } });

        await posAvailabilityAPI.getMenuAvailability(4);

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/v1/pos/menu-availability', { params: { warehouseId: 4 } });
    });

    it('indexes the items by menu item id', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({
            data: { success: true, data: { warehouseId: 4, items: [{ menuItemId: 8, status: 'LOW', portions: 2 }] } },
        });

        const map = await loadMenuAvailability(4);

        expect(map?.get(8)).toEqual({ menuItemId: 8, status: 'LOW', portions: 2 });
    });

    it('returns null (no data, never invented) when the request fails or the payload is malformed', async () => {
        vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('network'));
        await expect(loadMenuAvailability(4)).resolves.toBeNull();

        vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { success: true, data: {} } });
        await expect(loadMenuAvailability(4)).resolves.toBeNull();
    });
});
