import { Spinner } from '@/ui';
import './LoadingSpinner.css';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    text?: string;
}

const SIZE_PX = { sm: 16, md: 24, lg: 36 } as const;

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
    return (
        <div className="loading-spinner-container">
            <Spinner size={SIZE_PX[size]} label={text ?? 'Cargando'} />
            {text && <p className="loading-text">{text}</p>}
        </div>
    );
}

// Full page loading overlay
export function LoadingOverlay({ text = 'Cargando...' }: { text?: string }) {
    return (
        <div className="loading-overlay">
            <LoadingSpinner size="lg" text={text} />
        </div>
    );
}
