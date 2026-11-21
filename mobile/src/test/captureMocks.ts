import { vi } from 'vitest';

/** Test-only mocks for the WebView camera, canvas and geolocation. */
export interface CameraMock {
    track: { stop: ReturnType<typeof vi.fn> };
    getUserMedia: ReturnType<typeof vi.fn>;
    toBlob: ReturnType<typeof vi.fn>;
}

export function mockCamera(opts: { reject?: string } = {}): CameraMock {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => {
        if (opts.reject) throw Object.assign(new Error(opts.reject), { name: opts.reject });
        return stream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 720 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 960 });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
    const toBlob = vi.fn((cb: BlobCallback, type?: string) => cb(new Blob(['x'], { type: type ?? 'image/jpeg' })));
    HTMLCanvasElement.prototype.toBlob = toBlob as never;
    return { track, getUserMedia, toBlob };
}

export function mockGeolocation(result: { accuracy?: number; error?: number } = {}) {
    const getCurrentPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback, _opts?: PositionOptions) => {
        if (result.error) fail({ code: result.error, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
        else ok({ coords: { latitude: 1.5, longitude: -78.2, accuracy: result.accuracy ?? 12 }, timestamp: 1_700_000_000_000 } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    return getCurrentPosition;
}
