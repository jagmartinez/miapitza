import type { RefObject } from 'react';
import { FaceCaptureError } from './useFaceCapture';
import { LocationError } from './useLocation';
import { HrError } from '../hrApi';
import './attendance.css';

export const MSG = {
    cameraDenied: 'Activa la cámara para la app en Ajustes del teléfono.',
    cameraUnavailable: 'No se encontró una cámara frontal disponible o la usa otra app. Ciérrala e inténtalo de nuevo.',
    cameraUnknown: 'No fue posible iniciar la cámara. Inténtalo de nuevo.',
    locationDenied: 'Activa la ubicación para la app en Ajustes del teléfono.',
    locationTimeout: 'No se pudo obtener tu ubicación a tiempo. Sal a un lugar abierto y reintenta.',
    locationUnavailable: 'La ubicación no está disponible. Activa el GPS del teléfono y reintenta.',
    provider: 'El reconocimiento facial no está disponible. Intenta en unos minutos.',
    unconfirmed: 'No se pudo confirmar el envío. Revisa tu conexión y reintenta.',
};

export function newActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** First frame is `faceImage`, the rest `faceFrames` (server contract). */
export function appendFrames(form: FormData, frames: Blob[], prefix: string) {
    frames.forEach((frame, i) => {
        if (i === 0) form.append('faceImage', frame, `${prefix}-0.jpg`);
        else form.append('faceFrames', frame, `${prefix}-${i}.jpg`);
    });
}

/** Maps a camera/location/api failure to user copy. */
export function failureMessage(e: unknown): string {
    if (e instanceof FaceCaptureError) return e.kind === 'denied' ? MSG.cameraDenied : e.kind === 'unavailable' ? MSG.cameraUnavailable : MSG.cameraUnknown;
    if (e instanceof LocationError) return e.kind === 'denied' ? MSG.locationDenied : e.kind === 'timeout' ? MSG.locationTimeout : MSG.locationUnavailable;
    if (e instanceof HrError) return e.code === 'FACE_PROVIDER_UNAVAILABLE' ? MSG.provider : e.message || MSG.unconfirmed;
    return (e as Error)?.message || MSG.unconfirmed;
}

/** The video stays mounted (hidden) so the hook can attach the stream before the preview shows. */
export function CameraView({ videoRef, visible, instruction }: { videoRef: RefObject<HTMLVideoElement>; visible: boolean; instruction?: string }) {
    return (
        <div className="att-camera" hidden={!visible}>
            <video ref={videoRef} muted playsInline className="att-video" />
            {instruction && <p className="att-instruction" aria-live="assertive">{instruction}</p>}
        </div>
    );
}
