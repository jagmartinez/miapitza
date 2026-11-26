import { afterEach, describe, expect, it, vi } from 'vitest';
import { playKitchenChime } from './kitchenSound';

afterEach(() => vi.unstubAllGlobals());

describe('playKitchenChime', () => {
    it('is a no-op without AudioContext', () => {
        vi.stubGlobal('AudioContext', undefined);
        expect(() => playKitchenChime()).not.toThrow();
    });

    it('schedules two 800 Hz beeps and reuses one context', () => {
        const start = vi.fn();
        const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
        const ctor = vi.fn(function () {
            return {
                currentTime: 1,
                state: 'running',
                destination: {},
                resume: vi.fn(),
                createOscillator: () => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), start, stop: vi.fn() }),
                createGain: () => gain,
            };
        });
        vi.stubGlobal('AudioContext', ctor);
        playKitchenChime();
        playKitchenChime();
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledTimes(4);
        expect(start.mock.calls[1][0]).toBeCloseTo(1.4);
    });
});
