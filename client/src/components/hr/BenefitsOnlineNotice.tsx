import { CloudOff } from 'lucide-react';

export default function BenefitsOnlineNotice({ online }: { online: boolean }) {
  if (online) return null;

  return (
    <div className="hr-benefits-online offline" role="alert">
      <CloudOff size={18} aria-hidden="true" />
      <span>Sin conexión: consulta y acciones financieras bloqueadas. No se encolarán cambios.</span>
    </div>
  );
}
