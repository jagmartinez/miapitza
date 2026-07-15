import { CloudOff, ShieldCheck } from 'lucide-react';

export default function BenefitsOnlineNotice({ online }: { online: boolean }) {
  return (
    <div className={`hr-benefits-online ${online ? 'online' : 'offline'}`} role="status">
      {online ? (
        <ShieldCheck size={18} aria-hidden="true" />
      ) : (
        <CloudOff size={18} aria-hidden="true" />
      )}
      <span>
        {online
          ? 'Conexión verificada. Los importes visibles se consultan directamente al servidor.'
          : 'Sin conexión: consulta y acciones financieras bloqueadas. No se encolarán cambios.'}
      </span>
    </div>
  );
}
