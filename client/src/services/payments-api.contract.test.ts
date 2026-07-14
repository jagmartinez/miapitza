import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('./offlineManager', () => ({
    offlineManager: {
        enqueueRequest: vi.fn(),
        isOnline: vi.fn(() => true),
    },
}));

import api, { paymentsAPI } from './api';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('payments API contract', () => {
    it('sends an immutable payment reversal with its required reason in the DELETE body', async () => {
        const remove = vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } });

        await paymentsAPI.reverse(27, 'Cobro duplicado');

        expect(remove).toHaveBeenCalledWith('/payments/27', {
            data: { reason: 'Cobro duplicado' },
        });
    });
});
