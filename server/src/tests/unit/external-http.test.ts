import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
    ExternalHttpTimeoutError,
    externalHttpTimeoutMs,
    fetchWithTimeout
} from '../../utils/external-http';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('External HTTP operational boundary', () => {
    it('uses a bounded default and fails closed on invalid configuration', () => {
        expect(externalHttpTimeoutMs(undefined)).toBe(8_000);
        expect(externalHttpTimeoutMs('250')).toBe(250);
        expect(() => externalHttpTimeoutMs('0')).toThrow(/250 y 60000/);
        expect(() => externalHttpTimeoutMs('unbounded')).toThrow(/250 y 60000/);
    });

    it('aborts a stalled adapter and returns a typed timeout', async () => {
        jest.spyOn(global, 'fetch').mockImplementation(((_input: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            })) as typeof fetch);

        await expect(fetchWithTimeout('https://adapter.invalid/test', {}, 20))
            .rejects.toBeInstanceOf(ExternalHttpTimeoutError);
    });

    it('preserves an explicit caller cancellation instead of misreporting timeout', async () => {
        jest.spyOn(global, 'fetch').mockImplementation(((_input: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            })) as typeof fetch);
        const controller = new AbortController();
        const pending = fetchWithTimeout('https://adapter.invalid/test', { signal: controller.signal }, 500);
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});
