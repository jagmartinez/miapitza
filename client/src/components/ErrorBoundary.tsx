import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle, Home } from 'lucide-react';
import { Button } from '@/ui';
import { describeApiError } from '../utils/apiError';
import { markErrorHandled } from '../services/notify';
import './ErrorBoundary.css';

interface Props {
    children: ReactNode;
    /** Changing this value (e.g. the route path) clears a previous crash. */
    resetKey?: unknown;
    /** `app` fills the viewport; `page` stays inside the layout shell. */
    variant?: 'app' | 'page';
}

interface State {
    error: Error | null;
    resetKey?: unknown;
}

export const ERROR_BOUNDARY_TITLE = 'Algo salió mal en esta pantalla';

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null, resetKey: this.props.resetKey };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        if (props.resetKey !== state.resetKey) {
            return { resetKey: props.resetKey, error: null };
        }
        return null;
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // The fallback already tells the user; keep global handlers from toasting it too.
        markErrorHandled(error);
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    retry = () => {
        this.setState({ error: null });
    };

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        const described = describeApiError(error);
        const isChunkLoad = described.kind === 'chunkLoad';
        const variant = this.props.variant ?? 'app';
        const detail = isChunkLoad
            ? described.message
            : 'Ocurrió un error inesperado. Puedes reintentar; si el problema continúa, recarga la página o vuelve al inicio. Tus datos guardados no se perdieron.';

        return (
            <main className={`error-boundary error-boundary--${variant}`} role="alert" aria-live="assertive" data-testid="error-boundary">
                <AlertTriangle size={40} aria-hidden="true" className="error-boundary__icon" />
                <h1 className="error-boundary__title">{ERROR_BOUNDARY_TITLE}</h1>
                <p className="error-boundary__text">{detail}</p>
                <div className="error-boundary__actions">
                    {!isChunkLoad && (
                        <Button variant="primary" icon={RefreshCw} onClick={this.retry}>
                            Reintentar
                        </Button>
                    )}
                    <Button variant={isChunkLoad ? 'primary' : 'secondary'} icon={isChunkLoad ? RefreshCw : undefined} onClick={() => window.location.reload()}>
                        Recargar página
                    </Button>
                    <Button variant="secondary" icon={Home} onClick={() => window.location.assign('/dashboard')}>
                        Ir al inicio
                    </Button>
                </div>
                {import.meta.env?.DEV && (
                    <details className="error-boundary__details">
                        <summary>Detalle técnico</summary>
                        <pre>{error.stack || error.message}</pre>
                    </details>
                )}
            </main>
        );
    }
}
