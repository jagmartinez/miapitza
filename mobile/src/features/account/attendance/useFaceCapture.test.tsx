import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFaceCapture } from './useFaceCapture';
import { mockCamera } from './captureMocks';

afterEach(() => vi.useRealTimers());

describe('useFaceCapture', () => {
    it('captures 6 frames at 450 ms and stops tracks', async () => {
        vi.useFakeTimers();
        const cam = mockCamera();
        const { result } = renderHook(() => useFaceCapture());
        await act(async () => result.current.start());
        expect(cam.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
        let frames: Blob[] = [];
        let p!: Promise<Blob[]>;
        await act(async () => {
            p = result.current.captureFrames(6, 450);
            await vi.advanceTimersByTimeAsync(449);
        });
        expect(cam.toBlob).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(450 * 5);
            frames = await p;
        });
        expect(frames).toHaveLength(6);
        expect(cam.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.86]);
        act(() => result.current.stop());
        expect(cam.track.stop).toHaveBeenCalled();
    });

    it('stops tracks on unmount', async () => {
        const cam = mockCamera();
        const { result, unmount } = renderHook(() => useFaceCapture());
        await act(async () => result.current.start());
        unmount();
        expect(cam.track.stop).toHaveBeenCalled();
    });

    it('reports denied, unavailable and unknown errors', async () => {
        for (const [name, kind] of [['NotAllowedError', 'denied'], ['NotFoundError', 'unavailable'], ['Boom', 'unknown']] as const) {
            mockCamera({ reject: name });
            const { result } = renderHook(() => useFaceCapture());
            await act(async () => {
                await expect(result.current.start()).rejects.toMatchObject({ kind });
            });
            expect(result.current.error).toBe(kind);
        }
    });
});
