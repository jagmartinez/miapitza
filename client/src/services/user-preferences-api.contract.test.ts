import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('./offlineManager', () => ({
    offlineManager: { enqueueRequest: vi.fn(), isOnline: vi.fn(() => true) }
}));

import api, { usersAPI } from './api';

afterEach(() => { vi.restoreAllMocks(); });

describe('user preferences API contract', () => {
    it('reads from GET /users/me/preferences (api.ts prepends /api)', async () => {
        const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });
        await usersAPI.getPreferences();
        expect(get).toHaveBeenCalledWith('/users/me/preferences');
    });

    it('saves with PUT /users/me/preferences and the exact patch', async () => {
        const put = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
        await usersAPI.updatePreferences({ rowsPerPage: 50 });
        expect(put).toHaveBeenCalledWith('/users/me/preferences', { rowsPerPage: 50 });
    });
});
