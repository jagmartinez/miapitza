import { Component, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/ui';
import './ErrorBoundary.css';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <main className="error-boundary" role="alert">
                    <AlertTriangle size={40} aria-hidden="true" className="error-boundary__icon" />
                    <h1 className="error-boundary__title">Algo salió mal</h1>
                    <p className="error-boundary__text">
                        Ha ocurrido un error inesperado. Por favor recarga la página.
                    </p>
                    <div className="error-boundary__actions">
                        <Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>
                            Recargar página
                        </Button>
                    </div>
                </main>
            );
        }
        return this.props.children;
    }
}
