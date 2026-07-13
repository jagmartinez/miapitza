import { describe, expect, it } from 'vitest';
import { shouldQueueOfflineMutation } from './offlinePolicy';

describe('offline mutation policy', () => {
    it('queues only mutations with an explicit replay contract', () => {
        expect(shouldQueueOfflineMutation('post', false, false, true)).toBe(true);
        expect(shouldQueueOfflineMutation('delete', false, false, false)).toBe(false);
    });

    it('never queues auth, reads, or online requests', () => {
        expect(shouldQueueOfflineMutation('post', false, true, true)).toBe(false);
        expect(shouldQueueOfflineMutation('get', false, false, true)).toBe(false);
        expect(shouldQueueOfflineMutation('post', true, false, true)).toBe(false);
    });
});
