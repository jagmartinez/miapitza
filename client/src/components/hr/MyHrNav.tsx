import {
  Briefcase,
  CalendarDays,
  Clock3,
  Fingerprint,
  Home,
  FileText,
  WalletCards,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import './my-hr-nav.css';

const ITEMS = [
  { to: '/profile?tab=hr', label: 'Resumen', icon: Home, end: true },
  { to: '/rh/mi-portal/horario', label: 'Horario', icon: CalendarDays },
  { to: '/rh/mi-portal/gestion', label: 'Solicitudes', icon: Briefcase },
  { to: '/rh/mi-portal/nomina', label: 'Recibos', icon: FileText },
  { to: '/rh/mi-portal/prestaciones', label: 'Beneficios', icon: WalletCards },
  { to: '/rh/marcaje', label: 'Marcaje', icon: Clock3 },
  { to: '/rh/biometria', label: 'Mi biometría', icon: Fingerprint },
] as const;

/** Persistent, contextual navigation shared by every employee self-service view. */
export default function MyHrNav() {
  return (
    <nav className="my-hr-nav" aria-label="Secciones de mi portal RH">
      {ITEMS.map(({ to, label, icon: Icon, ...item }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in item ? item.end : undefined}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
