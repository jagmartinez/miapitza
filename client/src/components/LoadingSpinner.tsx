import './LoadingSpinner.css';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    text?: string;
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
    return (
        <div className="loading-spinner-container">
            <div className={`loading-spinner loading-spinner-${size}`}>
                <div className="spinner"></div>
            </div>
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
