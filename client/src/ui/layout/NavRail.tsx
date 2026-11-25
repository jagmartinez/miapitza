import { Link } from 'react-router-dom';
import { activeNavId, type NavGroup } from '../../navigation/navConfig';
import './layout.css';

/** Riel de navegación: 64 px con solo iconos (aria-label y title); `expanded` agrega las etiquetas. */
export function NavRail({ nav, activePath, expanded = false, onNavigate }: {
  nav: NavGroup[];
  activePath: string;
  expanded?: boolean;
  onNavigate?(): void;
}) {
  const activeId = activeNavId(nav, activePath);
  return (
    <nav className={`ui-navrail ${expanded ? 'is-expanded' : ''}`} aria-label="Navegación principal">
      {nav.map((group) => (
        <div key={group.id} className="ui-navrail__group" role="group" aria-label={group.label}>
          <p className="ui-navrail__group-label">{group.label}</p>
          {group.items.map((item) => {
            const active = item.id === activeId;
            return (
              <Link
                key={item.id}
                to={item.to}
                className={`ui-navrail__item ${active ? 'is-active' : ''}`}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                onClick={onNavigate}
              >
                <item.icon size={20} aria-hidden="true" />
                {expanded ? <span className="ui-navrail__text">{item.label}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
