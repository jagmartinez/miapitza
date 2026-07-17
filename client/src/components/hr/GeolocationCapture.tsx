import { useState } from 'react';
import { AlertTriangle, LocateFixed, RefreshCw } from 'lucide-react';
import Button from '../Button';
import type { HrCapturedLocation } from '../../types/hr-attendance';

interface GeolocationCaptureProps {
    maxAccuracyM: number;
    onCapture: (location: HrCapturedLocation | null) => void;
    disabled?: boolean;
}

export default function GeolocationCapture({ maxAccuracyM, onCapture, disabled = false }: GeolocationCaptureProps) {
    const [location, setLocation] = useState<HrCapturedLocation | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const capture = () => {
        if (disabled) return;
        if (!navigator.geolocation) {
            setError('Este navegador no ofrece geolocalización. Solicita el fallback supervisado.');
            onCapture(null);
            return;
        }
        setLoading(true);
        setError(null);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const evidence: HrCapturedLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracyM: position.coords.accuracy,
                    capturedAt: new Date(position.timestamp).toISOString(),
                };
                setLocation(evidence);
                onCapture(evidence);
                setLoading(false);
            },
            (positionError) => {
                const message = positionError.code === positionError.PERMISSION_DENIED
                    ? 'Permiso de ubicación denegado. Habilítalo en el navegador o solicita fallback supervisado.'
                    : positionError.code === positionError.TIMEOUT
                        ? 'La ubicación tardó demasiado. Acércate a una ventana o intenta nuevamente.'
                        : 'No fue posible obtener una ubicación confiable.';
                setError(message);
                setLocation(null);
                onCapture(null);
                setLoading(false);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
    };

    const acceptable = location ? location.accuracyM <= maxAccuracyM : false;

    return (
        <section className="hr-location-capture" aria-labelledby="hr-location-title">
            <div className="hr-evidence-heading">
                <LocateFixed size={19} aria-hidden="true" />
                <div><h3 id="hr-location-title">Ubicación del intento</h3><p>Se captura una posición puntual; no se realiza seguimiento continuo.</p></div>
            </div>
            {location && (
                <div className={`hr-location-result ${acceptable ? 'ok' : 'warning'}`} role="status">
                    {acceptable ? <LocateFixed size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
                    <div>
                        <strong>Ubicación capturada · precisión ±{Math.round(location.accuracyM)} m</strong>
                        <span>{acceptable ? `Precisión dentro del máximo de ${maxAccuracyM} m.` : `Supera el máximo de ${maxAccuracyM} m; el servidor aplicará la política configurada.`}</span>
                        <small>La distancia y la geocerca de tu sucursal se validan al confirmar.</small>
                    </div>
                </div>
            )}
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <Button type="button" variant="secondary" onClick={capture} disabled={disabled || loading}>
                {location ? <RefreshCw size={17} /> : <LocateFixed size={17} />}
                {loading ? 'Obteniendo ubicación…' : location ? 'Actualizar ubicación' : 'Capturar ubicación'}
            </Button>
        </section>
    );
}
