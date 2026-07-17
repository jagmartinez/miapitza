import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('./offlineManager', () => ({
    offlineManager: {
        enqueueRequest: vi.fn(),
        isOnline: vi.fn(() => true)
    }
}));

import api, { cateringAPI } from './api';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('catering payment and fiscal API contract', () => {
    it('sends the caller-owned idempotency key unchanged on every retry', async () => {
        const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
        const key = 'cat-client-operation-123';
        const payload = { amount: 25, paymentMethodId: 7 };

        await cateringAPI.addPayment(41, payload, key);
        await cateringAPI.addPayment(41, payload, key);

        expect(post).toHaveBeenCalledTimes(2);
        for (const call of post.mock.calls) {
            expect(call).toEqual([
                '/catering/41/payments',
                payload,
                { headers: { 'X-Idempotency-Key': key } }
            ]);
        }
    });

    it('keeps invoice issuance and full credit-note retries idempotent', async () => {
        const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
        await cateringAPI.issueFiscalInvoice(41, 'cat-invoice-operation-123');
        await cateringAPI.issueFiscalCreditNote(41, {
            reason: 'Cancelacion total',
            inventoryAction: 'NO_RETURN',
            externalRefunds: []
        }, 'cat-credit-operation-123');

        expect(post).toHaveBeenNthCalledWith(1,
            '/catering/41/fiscal-invoice',
            {},
            { headers: { 'X-Idempotency-Key': 'cat-invoice-operation-123' } }
        );
        expect(post).toHaveBeenNthCalledWith(2,
            '/catering/41/fiscal-credit-note',
            expect.objectContaining({ inventoryAction: 'NO_RETURN' }),
            { headers: { 'X-Idempotency-Key': 'cat-credit-operation-123' } }
        );
    });
});
