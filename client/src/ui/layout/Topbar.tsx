import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, User as UserIcon } from 'lucide-react';
import type { NavGroup } from '../../navigation/navConfig';
import './layout.css';

/** Barra superior: migas, buscador global (Ctrl+K, navega por el menú), controles y avatar. */
export function Topbar({ breadcrumb, nav, controls, userName, accentColor }: {
  breadcrumb?: string[];
  nav: NavGroup[];
  controls?: ReactNode;
  userName?: string;
  accentColor?: string;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nav.flatMap((g) => g.items).filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8);
  }, [nav, query]);

  const go = (to: string) => {
    navigate(to);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="ui-topbar">
      {breadcrumb?.length ? <p className="ui-topbar__crumb">{breadcrumb.join(' / ')}</p> : <span />}
      <div className="ui-topbar__search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="ui-topbar__input"
          placeholder="Buscar pantalla (Ctrl+K)"
          aria-label="Buscar pantalla"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].to);
            if (e.key === 'Escape') { setQuery(''); setOpen(false); }
          }}
        />
        {open && query.trim() ? (
          <ul className="ui-topbar__results" role="listbox" aria-label="Resultados">
            {results.length === 0 ? <li className="ui-topbar__empty">Sin resultados</li> : null}
            {results.map((r) => (
              <li key={r.id} role="option" aria-selected="false">
                <button type="button" className="ui-topbar__result" onMouseDown={(e) => e.preventDefault()} onClick={() => go(r.to)}>
                  <r.icon size={16} aria-hidden="true" />
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="ui-topbar__controls">
        {controls}
        <Link
          to="/profile"
          className="ui-topbar__avatar"
          aria-label={userName ? `Perfil de ${userName}` : 'Perfil'}
          title={userName ?? 'Perfil'}
          style={accentColor ? { background: accentColor } : undefined}
        >
          <UserIcon size={18} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
