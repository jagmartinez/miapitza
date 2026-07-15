import { CloudOff, ShieldCheck } from 'lucide-react';

export default function PayrollOnlineNotice({
  online,
  compact = false,
}: {
  online: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`hr-payroll-online ${online ? 'online' : 'offline'} ${compact ? 'compact' : ''}`}
      role={online ? 'note' : 'alert'}
    >
      {online ? (
        <ShieldCheck size={17} aria-hidden="true" />
      ) : (
        <CloudOff size={17} aria-hidden="true" />
      )}
      <span>
        {online
          ? 'Nómina opera sólo en línea, con idempotencia y trazabilidad del servidor.'
          : 'Sin conexión: cálculo, aprobación, pago, anulación y exportación están bloqueados. No existe cola offline.'}
      </span>
    </div>
  );
}
