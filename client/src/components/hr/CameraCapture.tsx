import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, CameraOff, CheckCircle2, RefreshCw } from 'lucide-react';
import type { HrAttendanceChallenge, HrFaceCaptureEvidence } from '../../types/hr-attendance';
import Button from '../Button';

interface CameraCaptureProps {
    onCapture: (evidence: HrFaceCaptureEvidence | null) => void;
    resetKey?: string | number;
    disabled?: boolean;
    instruction?: string;
    livenessAction?: HrAttendanceChallenge['livenessAction'];
    frameCount?: number;
    intervalMs?: number;
}

type CameraState = 'IDLE' | 'REQUESTING' | 'LIVE' | 'CAPTURING' | 'CAPTURED' | 'ERROR';
type CaptureGuidePhase = 'READY' | 'FRONT_COUNTDOWN' | 'FRONT_CAPTURE' | 'TURN_COUNTDOWN' | 'TURN_CAPTURE' | 'COMPLETE';

interface CaptureGuide {
    phase: CaptureGuidePhase;
    title: string;
    detail: string;
    countdown?: number;
    capturedFrames: number;
    totalFrames: number;
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export default function CameraCapture({
    onCapture,
    resetKey,
    disabled = false,
    instruction = 'Gira suavemente la cabeza hacia el lado indicado.',
    livenessAction,
    frameCount = 6,
    intervalMs = 450,
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
    const [captureGuide, setCaptureGuide] = useState<CaptureGuide | null>(null);

    const resolvedAction = livenessAction
        ?? (instruction.toLocaleLowerCase('es').includes('derecha') ? 'TURN_RIGHT' : 'TURN_LEFT');
    const turnSide = resolvedAction === 'TURN_LEFT' ? 'izquierdo' : 'derecho';
    const turnTitle = `Gira hacia tu hombro ${turnSide}`;
    const DirectionIcon = resolvedAction === 'TURN_LEFT' ? ArrowLeft : ArrowRight;

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
        setCaptureGuide(null);
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
        setCaptureGuide(null);
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
            setCaptureGuide({
                phase: 'READY',
                title: 'Centra tu rostro y mira al frente',
                detail: `Al comenzar verás una cuenta regresiva. No gires hacia tu hombro ${turnSide} hasta que aparezca “AHORA GIRA”.`,
                capturedFrames: 0,
                totalFrames: Math.min(6, Math.max(5, Math.trunc(frameCount))),
            });
            setCaptureStatus('Cámara lista. Mira al frente y pulsa “Comenzar prueba guiada”.');
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
        const safeFrameCount = Math.min(6, Math.max(5, Math.trunc(frameCount)));
        const safeInterval = Math.min(600, Math.max(400, Math.trunc(intervalMs)));
        const isActive = () => mountedRef.current && cameraRequestRef.current === requestId;
        const vibrate = (pattern: number | number[]) => {
            if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
        };
        const runCountdown = async (
            phase: Extract<CaptureGuidePhase, 'FRONT_COUNTDOWN' | 'TURN_COUNTDOWN'>,
            title: string,
            detail: string,
            capturedFrames: number,
        ) => {
            for (let remaining = 3; remaining >= 1; remaining -= 1) {
                if (!isActive()) return false;
                setCaptureGuide({
                    phase,
                    title,
                    detail,
                    countdown: remaining,
                    capturedFrames,
                    totalFrames: safeFrameCount,
                });
                setCaptureStatus(`${title}. ${remaining}.`);
                await wait(900);
            }
            return isActive();
        };
        setState('CAPTURING');
        setError(null);
        onCaptureRef.current(null);
        try {
            const frontReady = await runCountdown(
                'FRONT_COUNTDOWN',
                'Mira al frente',
                'Mantén el rostro dentro del óvalo. Todavía no gires.',
                0,
            );
            if (!frontReady) return;
            setCaptureGuide({
                phase: 'FRONT_CAPTURE',
                title: 'Capturando posición frontal',
                detail: 'Mantente quieto un instante.',
                capturedFrames: 0,
                totalFrames: safeFrameCount,
            });
            setCaptureStatus('Capturando la posición frontal ahora.');
            vibrate(60);
            await wait(250);
            const frames = [await captureFrame()];

            const turnReady = await runCountdown(
                'TURN_COUNTDOWN',
                `¡AHORA GIRA! ${turnTitle}`,
                `Gira despacio hacia tu hombro ${turnSide} y mantén esa posición cuando termine la cuenta.`,
                1,
            );
            if (!turnReady) return;
            vibrate([80, 60, 80]);
            while (frames.length < safeFrameCount) {
                if (!isActive()) return;
                const turnFrame = frames.length;
                setCaptureGuide({
                    phase: 'TURN_CAPTURE',
                    title: `Registrando giro hacia tu hombro ${turnSide}`,
                    detail: `Cuadro de giro ${turnFrame} de ${safeFrameCount - 1}. Mantén la cabeza girada.`,
                    capturedFrames: frames.length,
                    totalFrames: safeFrameCount,
                });
                setCaptureStatus(`Capturando giro: cuadro ${turnFrame} de ${safeFrameCount - 1}.`);
                if (frames.length === 1) await wait(180);
                frames.push(await captureFrame());
                setCaptureGuide({
                    phase: 'TURN_CAPTURE',
                    title: `Registrando giro hacia tu hombro ${turnSide}`,
                    detail: `Cuadro de giro ${frames.length - 1} de ${safeFrameCount - 1}. Mantén la cabeza girada.`,
                    capturedFrames: frames.length,
                    totalFrames: safeFrameCount,
                });
                if (frames.length < safeFrameCount) await wait(safeInterval);
            }
            if (!isActive()) return;
            clearPreview();
            const objectUrl = URL.createObjectURL(frames[0]);
            previewUrlRef.current = objectUrl;
            setPreviewUrl(objectUrl);
            setCaptureGuide({
                phase: 'COMPLETE',
                title: 'Secuencia capturada',
                detail: `Se registraron ${frames.length} cuadros. Al confirmar, el servidor comprobará que el giro coincide con la instrucción.`,
                capturedFrames: frames.length,
                totalFrames: safeFrameCount,
            });
            setCaptureStatus(`Secuencia capturada: ${frames.length} cuadros. El giro se validará al confirmar.`);
            setState('CAPTURED');
            stopStream();
            onCaptureRef.current({ frames });
        } catch (captureError) {
            if (!isActive()) return;
            setError(captureError instanceof Error ? captureError.message : 'No fue posible completar la secuencia facial.');
            setCaptureGuide({
                phase: 'READY',
                title: 'Intento interrumpido',
                detail: 'Centra nuevamente el rostro y repite la prueba guiada.',
                capturedFrames: 0,
                totalFrames: safeFrameCount,
            });
            setCaptureStatus('La secuencia no se completó. Puedes intentarlo nuevamente.');
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
                {(state === 'LIVE' || state === 'CAPTURING') && <span className="hr-camera-face-guide" aria-hidden="true" />}
                {captureGuide && state !== 'IDLE' && state !== 'REQUESTING' && state !== 'ERROR' && (
                    <div className={`hr-camera-guide phase-${captureGuide.phase.toLowerCase()}`} aria-hidden="true">
                        <div className="hr-camera-guide__heading">
                            {captureGuide.phase === 'TURN_COUNTDOWN' || captureGuide.phase === 'TURN_CAPTURE'
                                ? <DirectionIcon size={34} strokeWidth={2.5} />
                                : captureGuide.phase === 'COMPLETE'
                                    ? <CheckCircle2 size={30} />
                                    : <Camera size={28} />}
                            <div>
                                <strong>{captureGuide.title}</strong>
                                <span>{captureGuide.detail}</span>
                            </div>
                        </div>
                        {captureGuide.countdown !== undefined && (
                            <span className="hr-camera-guide__countdown">{captureGuide.countdown}</span>
                        )}
                        {(captureGuide.phase === 'FRONT_CAPTURE' || captureGuide.phase === 'TURN_CAPTURE') && (
                            <div className="hr-camera-guide__recording">
                                <span className="hr-camera-recording-dot" />
                                <strong>CAPTURANDO</strong>
                                <span>{captureGuide.capturedFrames}/{captureGuide.totalFrames} cuadros</span>
                            </div>
                        )}
                        {(captureGuide.phase === 'TURN_CAPTURE' || captureGuide.phase === 'COMPLETE') && (
                            <div className="hr-camera-guide__progress" aria-label={`${captureGuide.capturedFrames} de ${captureGuide.totalFrames} cuadros capturados`}>
                                {Array.from({ length: captureGuide.totalFrames }, (_, index) => (
                                    <span key={index} className={index < captureGuide.capturedFrames ? 'complete' : ''} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <canvas ref={canvasRef} hidden aria-hidden="true" />
            {captureStatus && <div className="hr-attendance-alert info" role="status" aria-live="polite">{captureStatus}</div>}
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <div className="hr-evidence-actions">
                {(state === 'IDLE' || state === 'ERROR') && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><Camera size={17} /> Activar cámara</Button>}
                {state === 'REQUESTING' && <Button type="button" variant="secondary" disabled>Solicitando permiso…</Button>}
                {state === 'LIVE' && <Button type="button" onClick={() => void captureSequence()} disabled={disabled}><Camera size={17} /> Comenzar prueba guiada</Button>}
                {state === 'CAPTURING' && <Button type="button" disabled>Prueba de vida en curso…</Button>}
                {state === 'CAPTURED' && <Button type="button" variant="secondary" onClick={() => void startCamera()} disabled={disabled}><RefreshCw size={17} /> Repetir secuencia</Button>}
            </div>
        </section>
    );
}
