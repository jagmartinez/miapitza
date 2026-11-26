import './primitives.css';

export function Spinner({ size = 16, label = 'Cargando' }: { size?: number; label?: string }) {
  return <span className="ui-spinner" role="status" aria-label={label} style={{ width: size, height: size }} />;
}
