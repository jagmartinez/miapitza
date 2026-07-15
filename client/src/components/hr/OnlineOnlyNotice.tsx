import { CloudOff, Wifi } from 'lucide-react';

export default function OnlineOnlyNotice({
  online,
  compact = false,
}: {
  online: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`hr-online-notice ${online ? 'online' : 'offline'} ${compact ? 'compact' : ''}`}
      role={online ? 'note' : 'alert'}
    >
      {online ? <Wifi size={17} aria-hidden="true" /> : <CloudOff size={17} aria-hidden="true" />}
      <span>
        {online
          ? 'Las decisiones y ajustes se registran sólo en línea, con auditoría del servidor.'
          : 'Sin conexión: consultas visibles pueden estar desactualizadas y las mutaciones están bloqueadas. No existe cola offline.'}
      </span>
    </div>
  );
}
