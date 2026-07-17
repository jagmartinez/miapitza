import { ArrowLeft, Clock3, LayoutGrid } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './my-hr-nav.css';

/** Compact self-service navigation: back to the launcher plus a mobile-first punch shortcut. */
export default function MyHrNav() {
  const location = useLocation();

  return (
    <nav className="my-hr-nav" aria-label="Navegación de Mi RH">
      <Link className="my-hr-nav__home" to="/profile?tab=hr">
        <ArrowLeft size={16} aria-hidden="true" />
        <LayoutGrid size={16} aria-hidden="true" />
        <span>Mis accesos de RH</span>
      </Link>
      {location.pathname !== '/rh/marcaje' && (
        <Link className="my-hr-nav__punch" to="/rh/marcaje">
          <Clock3 size={17} aria-hidden="true" />
          <span>Marcar ahora</span>
        </Link>
      )}
    </nav>
  );
}
