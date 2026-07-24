import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from './Button';
import './LoadErrorState.css';

interface LoadErrorStateProps {
    message: string;
    onRetry: () => void;
    retrying?: boolean;
}

export default function LoadErrorState({ message, onRetry, retrying = false }: LoadErrorStateProps) {
    return (
        <div className="load-error-state" role="alert">
            <AlertTriangle size={24} aria-hidden="true" />
            <div className="load-error-state-copy">
                <strong>No se pudo cargar la información</strong>
                <span>{message}</span>
            </div>
            <Button type="button" variant="secondary" onClick={onRetry} disabled={retrying}>
                <RefreshCw size={17} aria-hidden="true" />
                {retrying ? 'Reintentando…' : 'Reintentar'}
            </Button>
        </div>
    );
}
