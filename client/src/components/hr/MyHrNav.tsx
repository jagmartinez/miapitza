import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import './my-hr-nav.css';

/** Back link to the card-based Mi RH launcher. Individual sections no longer repeat it as tabs. */
export default function MyHrNav() {
  return (
    <nav className="my-hr-nav" aria-label="Volver a Mis accesos de RH">
      <Link to="/profile?tab=hr">
        <ArrowLeft size={16} aria-hidden="true" />
        <LayoutGrid size={16} aria-hidden="true" />
        <span>Mis accesos de RH</span>
      </Link>
    </nav>
  );
}
