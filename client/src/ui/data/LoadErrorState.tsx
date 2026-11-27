import { AlertTriangle } from 'lucide-react';
import { Button } from '../primitives/Button';
import './data.css';

/** Error recuperable de una sección: dice qué falló y deja reintentar sin tumbar el resto de la página. */
export function LoadErrorState({ message, onRetry, retryLabel = 'Reintentar' }: { message: string; onRetry?(): void; retryLabel?: string }) {
  return (
    <div className="ui-loaderror" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <p className="ui-loaderror__msg">{message}</p>
      {onRetry ? <Button variant="ghost" size="sm" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}
