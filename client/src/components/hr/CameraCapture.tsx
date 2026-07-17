import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';
import type { HrFaceCaptureEvidence } from '../../types/hr-attendance';
import Button from '../Button';

interface CameraCaptureProps {
    onCapture: (evidence: HrFaceCaptureEvidence | null) => void;
    resetKey?: string | number;
    disabled?: boolean;
    instruction?: string;
    frameCount?: number;
    intervalMs?: number;
}

type CameraState = 'IDLE' | 'REQUESTING' | 'LIVE' | 'CAPTURING' | 'CAPTURED' | 'ERROR';

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export default function CameraCapture({
    onCapture,
    resetKey,
    disabled = false,
    instruction = 'Gira suavemente la cabeza hacia el lado indicado.',
    frameCount = 5,
    intervalMs = 320,
}: CameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const previewUrlRef = useRef<string | null>(null);
    const onCaptureRef = useRef(onCapture);
    const cameraRequestRef = useRef(0);
    const mountedRef = useRef(true);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [state, setState] = useState<CameraState>('IDLE');
    const [error, setError] = useState<string | null>(null);
    const [captureStatus, setCaptureStatus] = useState<string | null>(null);

    useEffect(() => {
        onCaptureRef.current = onCapture;
    }, [onCapture]);

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    }, []);

    const clearPreview = useCallback(() => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
    }, []);

    const reset = useCallback(() => {
        cameraRequestRef.current += 1;
        stopStream();
        clearPreview();
        setError(null);
        setCaptureStatus(null);
        setState('IDLE');
        onCaptureRef.current(null);
    }, [clearPreview, stopStream]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            cameraRequestRef.current += 1;
            stopStream();
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
            onCaptureRef.current(null);
        };
    }, [stopStream]);

    useEffect(() => {
        reset();
    // resetKey deliberately represents a new server challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    const startCamera = async () => {
        if (disabled) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            setError('Este navegador no permite captura de cámara. Solicita el fallback supervisado.');
            setState('ERROR');
            return;
        }
        const requestId = cameraRequestRef.current + 1;
        cameraRequestRef.current = requestId;
        stopStream();
        clearPreview();
        onCaptureRef.current(null);
        setError(null);
        setCaptureStatus(null);
        setState('REQUESTING');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
                audio: false,
            });
            if (!mountedRef.current || cameraRequestRef.current !== requestId) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setState('LIVE');
        } catch (cameraError) {
            if (!mountedRef.current || cameraRequestRef.current !== requestId) return;
            stopStream();
            const name = cameraError instanceof DOMException ? cameraError.name : '';
            setError(name === 'NotAllowedError'
                ? 'Permiso de cámara denegado. Puedes habilitarlo en el navegador o solicitar fallback supervisado.'
                : 'No fue posible iniciar la cámara. Verifica que no esté siendo usada por otra aplicación.');
            setState('ERROR');
        }
    };

    const captureFrame = (): Promise<Blob> => new Promise((resolve, reject) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
            reject(new Error('La cámara todavía no está lista. Intenta nuevamente.'));
            return;
        }
        const side = Math.min(video.videoWidth, video.videoHeight);
        canvas.width = 640;
        canvas.height = 640;
        const context = canvas.getContext('2d');
        if (!context) {
            reject(new Error('No fue posible preparar la evidencia facial.'));
            return;
        }
        context.drawImage(
            video,
            (video.videoWidth - side) / 2,
            (video.videoHeight - side) / 2,
            side,
            side,
            0,
            0,
            canvas.width,
            canvas.height,
        );
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('No fue posible capturar uno de los cuadros.'));
        }, 'image/jpeg', 0.86);
    });

    const captureSequence = async () => {
        if (disabled || state !== 'LIVE') return;
        const requestId = cameraRequestRef.current;
        const safeFrameCount = Math.min(6, Math.max(4, Math.trunc(frameCount)));
        const safeInterval = Math.min(600, Math.max(250, Math.trunc(intervalMs)));
        setState('CAPTURING');
        setError(null);
        onCaptureRef.current(null);
        try {
            setCaptureStatus('Mira al frente y mantente quieto.');
            await wait(650);
            const frames = [await captureFrame()];
            setCaptureStatus(instruction);
            await wait(450);
            while (frames.length < safeFrameCount) {
                if (!mountedRef.current || cameraRequestRef.current !== requestId) return;
                frames.push(await captureFrame());
                if (frames.length < safeFrameCount) await wait(safeInterval);
            }
            if (!mountedRef.current || cameraRequestRef.current !== requestId) return;
            clearPreview();
            const objectUrl = URL.createObjectURL(frames[0]);
            previewUrlRef.current = objectUrl;
            setPreviewUrl(objectUrl);
            setCaptureStatus(`Secuencia segura completada: ${frames.length} cuadros.`);
            setState('CAPTURED');
            stopStream();
            onCaptureRef.current({ frames });
        } catch (captureError) {
            if (!mountedRef.current || cameraRequestRef.current !== requestId) return;
            setError(captureError instanceof Error ? captureError.message : 'No fue posible completar la secuencia facial.');
            setCaptureStatus(null);
            setState('LIVE');
            onCaptureRef.current(null);
        }
    };

    return (
        <section className="hr-camera-capture" aria-labelledby="hr-camera-title">
            <div className="hr-evidence-heading">
                <Camera size={19} aria-hidden="true" />
                <div><h3 id="hr-camera-title">Evidencia facial</h3><p>La secuencia se mantiene sólo en memoria durante este intento y se envía para verificación 1:1 y prueba de vida.</p></div>
            </div>
            <div className="hr-camera-stage">
                {previewUrl
                    ? <img src={previewUrl} alt="Vista previa del primer cuadro facial del intento actual" />
                    : <video ref={videoRef} muted playsInline aria-label="Vista en vivo de la cámara frontal" />}
                {(state === 'IDLE' || state === 'ERROR') && <CameraOff size={40} aria-hidden="true" />}
            </div>
            <canvas ref={canvasRef} hidden aria-hidden="true" />
            {captureStatus && <div className="hr-attendance-alert info" role="status" aria-live="polite">{captureStatus}</div>}
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <div className="hr-evidence-actions">
                {(state === 'IDLE' || state === 'ERROR') && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><Camera size={17} /> Activar cámara</Button>}
                {state === 'REQUESTING' && <Button type="button" variant="secondary" disabled>Solicitando permiso…</Button>}
                {state === 'LIVE' && <Button type="button" onClick={() => void captureSequence()} disabled={disabled}><Camera size={17} /> Iniciar prueba de vida</Button>}
                {state === 'CAPTURING' && <Button type="button" disabled>Capturando secuencia…</Button>}
                {state === 'CAPTURED' && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><RefreshCw size={17} /> Repetir secuencia</Button>}
            </div>
        </section>
    );
}
