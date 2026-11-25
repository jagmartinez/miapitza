import { CloudOff } from 'lucide-react';

export default function OnlineOnlyNotice({
  online,
  compact = false,
}: {
  online: boolean;
  compact?: boolean;
}) {
  if (online) return null;

  return (
    <div
      className={`hr-online-notice offline ${compact ? 'compact' : ''}`}
      role="alert"
    >
      <CloudOff size={17} aria-hidden="true" />
      <span>Sin conexión: consultas visibles pueden estar desactualizadas y las mutaciones están bloqueadas. No existe cola offline.</span>
    </div>
  );
}
