import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './MyHrNav.module.css';

/** Back link to the card-based Mi RH launcher. Individual sections no longer repeat it as tabs. */
export default function MyHrNav() {
  return (
    <nav className={styles.nav} aria-label="Volver a Mis accesos de RH">
      <Link to="/profile?tab=hr" className={styles.link}>
        <ArrowLeft size={16} aria-hidden="true" />
        <LayoutGrid size={16} aria-hidden="true" />
        <span>Mis accesos de RH</span>
      </Link>
    </nav>
  );
}
