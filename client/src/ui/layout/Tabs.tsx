import { useId, type KeyboardEvent } from 'react';
import type { ModalTab } from '../overlays/FullScreenModal';
import './layout.css';

export function Tabs({ tabs, active, onChange, ariaLabel }: {
  tabs: ModalTab[];
  active: string;
  onChange(id: string): void;
  ariaLabel: string;
}) {
  const uid = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    e.preventDefault();
    const idx = enabled.findIndex((t) => t.id === active);
    const next = enabled[(idx + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    onChange(next.id);
    requestAnimationFrame(() => document.getElementById(`${uid}-${next.id}`)?.focus());
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${uid}-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          tabIndex={t.id === active ? 0 : -1}
          disabled={t.disabled}
          className={`ui-tabs__tab ${t.id === active ? 'is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge !== undefined ? <span className="ui-tabs__badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
