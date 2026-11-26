import { Button } from '../primitives/Button';
import './settings.css';

export function UnsavedChangesBar({ count, hasErrors, saving, onDiscard, onSave }: {
  count: number;
  hasErrors: boolean;
  saving: boolean;
  onDiscard(): void;
  onSave(): void;
}) {
  return (
    <div className="ui-unsaved" role="region" aria-label="Cambios sin guardar">
      <span className="ui-unsaved__text">
        {count} {count === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
        {hasErrors ? ' · corrige los errores para guardar' : ''}
      </span>
      <div className="ui-unsaved__actions">
        <Button variant="secondary" onClick={onDiscard} disabled={saving}>Descartar</Button>
        <Button variant="primary" onClick={onSave} disabled={hasErrors || saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}
