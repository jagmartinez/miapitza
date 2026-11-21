import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type FaceCaptureErrorKind = 'denied' | 'unavailable' | 'unknown';

export class FaceCaptureError extends Error {
    kind: FaceCaptureErrorKind;
    constructor(kind: FaceCaptureErrorKind) {
        super(kind);
        this.name = 'FaceCaptureError';
        this.kind = kind;
    }
}

const SIZE = 640;

function kindOf(e: unknown): FaceCaptureErrorKind {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') return 'unavailable';
    return 'unknown';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Front camera frames for the liveness challenge. Render `<video ref={videoRef} muted playsInline />` for the preview. */
export function useFaceCapture(): {
    start: () => Promise<void>;
    captureFrames: (count?: number, intervalMs?: number) => Promise<Blob[]>;
    stop: () => void;
    error?: FaceCaptureErrorKind;
    videoRef: RefObject<HTMLVideoElement>;
} {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detached = useRef<HTMLVideoElement | null>(null);
    const [error, setError] = useState<FaceCaptureErrorKind | undefined>();

    const stop = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const v = videoRef.current ?? detached.current;
        if (v) v.srcObject = null;
        detached.current = null;
    }, []);

    useEffect(() => stop, [stop]);

    const start = useCallback(async () => {
        stop();
        setError(undefined);
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera api'), { name: 'NotFoundError' });
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
            streamRef.current = stream;
            const video = videoRef.current ?? (detached.current = document.createElement('video'));
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            await video.play();
        } catch (e) {
            stop();
            const kind = kindOf(e);
            setError(kind);
            throw new FaceCaptureError(kind);
        }
    }, [stop]);

    const grab = useCallback(async (): Promise<Blob> => {
        const video = videoRef.current ?? detached.current;
        if (!video) throw new FaceCaptureError('unavailable');
        if (!video.videoWidth) {
            await new Promise<void>((resolve) => {
                const done = () => resolve();
                video.addEventListener('loadeddata', done, { once: true });
                setTimeout(done, 2000);
            });
        }
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new FaceCaptureError('unknown');
        // Center-crop to a square, like the web capture.
        const side = Math.min(video.videoWidth, video.videoHeight) || SIZE;
        const sx = ((video.videoWidth || side) - side) / 2;
        const sy = ((video.videoHeight || side) - side) / 2;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, SIZE, SIZE);
        return new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new FaceCaptureError('unknown'))), 'image/jpeg', 0.86),
        );
    }, []);

    const captureFrames = useCallback(
        async (count = 6, intervalMs = 450) => {
            const frames: Blob[] = [];
            for (let i = 0; i < count; i++) {
                if (i > 0) await sleep(intervalMs);
                frames.push(await grab());
            }
            return frames;
        },
        [grab],
    );

    return { start, captureFrames, stop, error, videoRef };
}
