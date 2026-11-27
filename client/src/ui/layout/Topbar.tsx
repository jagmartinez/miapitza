import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Search, User as UserIcon, UserRound } from 'lucide-react';
import type { NavGroup } from '../../navigation/navConfig';
import './layout.css';

/** Barra superior: migas, buscador global (Ctrl+K, navega por el menú), controles y avatar. */
export function Topbar({ breadcrumb, nav, controls, userName, userDetail, accentColor, onLogout, logoutLabel = 'Cerrar sesión' }: {
  breadcrumb?: string[];
  nav: NavGroup[];
  controls?: ReactNode;
  userName?: string;
  userDetail?: string;
  accentColor?: string;
  onLogout?(): void;
  logoutLabel?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
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
        <div className="ui-topbar__account" ref={menuRef}>
          <button
            type="button"
            className="ui-topbar__avatar"
            aria-label={userName ? `Cuenta de ${userName}` : 'Cuenta'}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            style={accentColor ? { background: accentColor } : undefined}
          >
            <UserIcon size={18} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="ui-topbar__menu" role="menu" aria-label="Cuenta">
              {userName ? (
                <div className="ui-topbar__menuhead">
                  <strong>{userName}</strong>
                  {userDetail ? <span>{userDetail}</span> : null}
                </div>
              ) : null}
              <Link to="/profile" role="menuitem" className="ui-topbar__menuitem" onClick={() => setMenuOpen(false)}>
                <UserRound size={16} aria-hidden="true" /> Perfil y Mi RH
              </Link>
              {onLogout ? (
                <button type="button" role="menuitem" className="ui-topbar__menuitem is-danger" onClick={() => { setMenuOpen(false); onLogout(); }}>
                  <LogOut size={16} aria-hidden="true" /> {logoutLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
