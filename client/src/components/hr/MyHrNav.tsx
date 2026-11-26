import { ArrowLeft, Clock3, LayoutGrid } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import styles from './MyHrNav.module.css';

/** Self-service navigation as wrap-friendly pills: back to the launcher plus a punch shortcut. */
export default function MyHrNav() {
  const location = useLocation();

  return (
    <nav className={styles.nav} aria-label="Navegación de Mi RH">
      <Link to="/profile?tab=hr" className={styles.link}>
        <ArrowLeft size={16} aria-hidden="true" />
        <LayoutGrid size={16} aria-hidden="true" />
        <span>Mis accesos de RH</span>
      </Link>
      {location.pathname !== '/rh/marcaje' && (
        <Link to="/rh/marcaje" className={`${styles.link} ${styles.punch}`}>
          <Clock3 size={17} aria-hidden="true" />
          <span>Marcar ahora</span>
        </Link>
      )}
    </nav>
  );
}
