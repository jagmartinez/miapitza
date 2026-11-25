import { CloudOff } from 'lucide-react';

export default function PayrollOnlineNotice({
  online,
  compact = false,
}: {
  online: boolean;
  compact?: boolean;
}) {
  if (online) return null;

  return (
    <div
      className={`hr-payroll-online offline ${compact ? 'compact' : ''}`}
      role="alert"
    >
      <CloudOff size={17} aria-hidden="true" />
      <span>Sin conexión: cálculo, aprobación, pago, anulación y exportación están bloqueados. No existe cola offline.</span>
    </div>
  );
}
