import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../pages/PurchaseOrders.tsx', import.meta.url), 'utf8');
const formSource = readFileSync(new URL('../pages/PurchaseOrderForm.tsx', import.meta.url), 'utf8');

describe('purchase mutation idempotency contract', () => {
    it('sends a caller-stable key for receipt, reversal and payment writes', () => {
        const purchaseApi = apiSource.slice(
            apiSource.indexOf('export const purchaseOrdersAPI'),
            apiSource.indexOf('export const kitchenNotificationsAPI'),
        );
        expect(purchaseApi.match(/'X-Idempotency-Key': idempotencyKey/g)).toHaveLength(4);
    });

    it('retains ambiguous attempts and clears them immediately after mutation confirmation', () => {
        expect(formSource).toContain('receiveAttemptRef.current = attempt');
        expect(formSource).toContain('receiveAttemptRef.current = null');
        expect(listSource).toContain('addPaymentAttemptRef.current = attempt');
        expect(listSource).toContain('addPaymentAttemptRef.current = null');
        expect(listSource).toContain('reversePaymentAttemptRef.current = attempt');
        expect(listSource).toContain('reversePaymentAttemptRef.current = null');
    });
});
