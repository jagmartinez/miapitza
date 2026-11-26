import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { toastDuration } from '../context/toastQueue';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

const TYPE_LABEL: Record<ToastType, string> = {
    success: 'Éxito',
    error: 'Error',
    warning: 'Advertencia',
    info: 'Información',
};

interface ToastProps {
    message: string;
    type?: ToastType;
    duration?: number;
    /** Incremented when an identical notice is re-published; restarts the timer. */
    count?: number;
    onClose: () => void;
}

export default function Toast({ message, type = 'info', duration, count = 1, onClose }: ToastProps) {
    const [isVisible, setIsVisible] = useState(true);
    const [paused, setPaused] = useState(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const effectiveDuration = toastDuration(type, message, duration);

    useEffect(() => {
        if (paused) return undefined;
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const timer = setTimeout(() => {
            setIsVisible(false);
            closeTimer = setTimeout(() => onCloseRef.current(), 300);
        }, effectiveDuration);

        return () => {
            clearTimeout(timer);
            if (closeTimer) clearTimeout(closeTimer);
        };
    }, [effectiveDuration, paused, count]);

    const getIcon = () => {
        switch (type) {
            case 'success':
                return <CheckCircle size={20} aria-hidden="true" />;
            case 'error':
                return <AlertCircle size={20} aria-hidden="true" />;
            case 'warning':
                return <AlertTriangle size={20} aria-hidden="true" />;
            default:
                return <Info size={20} aria-hidden="true" />;
        }
    };

    return (
        <div
            className={`toast toast-${type} ${isVisible ? 'toast-visible' : 'toast-hidden'}`}
            data-testid={`toast-${type}`}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <div className="toast-icon">{getIcon()}</div>
            <div className="toast-message">
                <span className="sr-only">{TYPE_LABEL[type]}: </span>
                {message}
                {count > 1 && <span className="toast-count" aria-label={`repetido ${count} veces`}>×{count}</span>}
            </div>
            <button
                type="button"
                className="toast-close"
                aria-label="Cerrar notificación"
                onClick={() => {
                    setIsVisible(false);
                    setTimeout(onClose, 300);
                }}
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
}

export interface ToastItemData {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
    count?: number;
}

interface ToastContainerProps {
    toasts: ToastItemData[];
    onRemove: (id: string) => void;
}

const isUrgent = (type: ToastType) => type === 'error' || type === 'warning';

/**
 * Two persistent live regions: errors/warnings are announced assertively,
 * success/info politely. The regions exist before any toast is inserted
 * (required for reliable announcements), and toasts themselves carry no
 * `alert` role so they never compete with a page's own inline alert.
 */
export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
    const renderToast = (toast: ToastItemData) => (
        <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            count={toast.count}
            onClose={() => onRemove(toast.id)}
        />
    );
    return (
        <section className="toast-container" aria-label="Notificaciones" data-testid="toast-container">
            <div className="toast-stack" aria-live="assertive" aria-relevant="additions text" data-testid="toast-stack-urgent">
                {toasts.filter((t) => isUrgent(t.type)).map(renderToast)}
            </div>
            <div className="toast-stack" role="status" aria-live="polite" aria-relevant="additions text">
                {toasts.filter((t) => !isUrgent(t.type)).map(renderToast)}
            </div>
        </section>
    );
}
