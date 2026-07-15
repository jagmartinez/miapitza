import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';
import Button from '../Button';

interface CameraCaptureProps {
    onCapture: (image: Blob | null) => void;
    resetKey?: string | number;
    disabled?: boolean;
}

type CameraState = 'IDLE' | 'REQUESTING' | 'LIVE' | 'CAPTURED' | 'ERROR';

export default function CameraCapture({ onCapture, resetKey, disabled = false }: CameraCaptureProps) {
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
        setState('IDLE');
        onCapture(null);
    }, [clearPreview, onCapture, stopStream]);

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
        onCapture(null);
        setError(null);
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

    const capture = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
            setError('La cámara todavía no está lista. Intenta nuevamente.');
            return;
        }
        const side = Math.min(video.videoWidth, video.videoHeight);
        canvas.width = 640;
        canvas.height = 640;
        const context = canvas.getContext('2d');
        if (!context) {
            setError('No fue posible preparar la evidencia facial.');
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
        const requestId = cameraRequestRef.current;
        canvas.toBlob((blob) => {
            if (!mountedRef.current || cameraRequestRef.current !== requestId) return;
            if (!blob) {
                setError('No fue posible capturar la imagen.');
                return;
            }
            clearPreview();
            const objectUrl = URL.createObjectURL(blob);
            previewUrlRef.current = objectUrl;
            setPreviewUrl(objectUrl);
            setState('CAPTURED');
            stopStream();
            onCapture(blob);
        }, 'image/jpeg', 0.86);
    };

    return (
        <section className="hr-camera-capture" aria-labelledby="hr-camera-title">
            <div className="hr-evidence-heading">
                <Camera size={19} aria-hidden="true" />
                <div><h3 id="hr-camera-title">Evidencia facial</h3><p>La imagen se mantiene sólo en memoria durante este intento y se envía al servidor para verificación 1:1.</p></div>
            </div>
            <div className="hr-camera-stage">
                {previewUrl
                    ? <img src={previewUrl} alt="Vista previa de la captura facial del intento actual" />
                    : <video ref={videoRef} muted playsInline aria-label="Vista en vivo de la cámara frontal" />}
                {(state === 'IDLE' || state === 'ERROR') && <CameraOff size={40} aria-hidden="true" />}
            </div>
            <canvas ref={canvasRef} hidden aria-hidden="true" />
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <div className="hr-evidence-actions">
                {(state === 'IDLE' || state === 'ERROR') && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><Camera size={17} /> Activar cámara</Button>}
                {state === 'REQUESTING' && <Button type="button" variant="secondary" disabled>Solicitando permiso…</Button>}
                {state === 'LIVE' && <Button type="button" onClick={capture} disabled={disabled}><Camera size={17} /> Capturar</Button>}
                {state === 'CAPTURED' && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><RefreshCw size={17} /> Repetir captura</Button>}
            </div>
        </section>
    );
}
