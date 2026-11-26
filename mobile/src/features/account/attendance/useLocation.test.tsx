import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from './useLocation';
import { mockGeolocation } from '../../../test/captureMocks';

afterEach(() => vi.useRealTimers());

describe('useLocation', () => {
    it('returns the fix with high accuracy options', async () => {
        const spy = mockGeolocation({ accuracy: 12 });
        const { result } = renderHook(() => useLocation());
        const fix = await result.current.get();
        expect(fix).toMatchObject({ latitude: 1.5, longitude: -78.2, accuracyM: 12 });
        expect(typeof fix.capturedAt).toBe('string');
        expect(spy.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });

    it('maps errors', async () => {
        for (const [code, kind] of [[1, 'denied'], [3, 'timeout'], [2, 'unavailable']] as const) {
            mockGeolocation({ error: code });
            const { result } = renderHook(() => useLocation());
            await expect(result.current.get()).rejects.toMatchObject({ kind });
        }
    });

    it('a prompt that never answers times out after the watchdog', async () => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } });
        const { result } = renderHook(() => useLocation());
        const p = result.current.get().catch((e) => e);
        await vi.advanceTimersByTimeAsync(20_100);
        expect(await p).toMatchObject({ kind: 'timeout' });
    });
});
