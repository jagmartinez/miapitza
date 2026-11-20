import type { ComponentType, ReactNode } from 'react';
import './hr-workspace.css';

/**
 * RH layout kit. Mirrors the account centre (Profile) visual language so every
 * RH screen reads the same way: hero card with facts → pill tabs → toolbar →
 * section cards. Pages compose these instead of inventing their own chrome.
 */

// Accepts lucide icons and small wrapper components alike.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = ComponentType<any>;

export function HrPage({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`page-wrapper hr-ws-page ${className}`.trim()}>{children}</div>;
}

export type HrFact = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
};

export function HrHero({
  eyebrow,
  icon: Icon,
  title,
  subtitle,
  badges,
  actions,
  facts,
  aside,
}: {
  eyebrow?: ReactNode;
  icon?: IconType;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  facts?: HrFact[];
  aside?: ReactNode;
}) {
  return (
    <header className={`hr-ws-hero${aside ? ' has-aside' : ''}`}>
      <div className="hr-ws-hero-main">
        {Icon && <span className="hr-ws-hero-icon" aria-hidden="true"><Icon size={24} /></span>}
        <div className="hr-ws-hero-text">
          {eyebrow && <span className="hr-ws-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
          {badges && <div className="hr-ws-badges">{badges}</div>}
        </div>
        {actions && <div className="hr-ws-hero-actions">{actions}</div>}
      </div>
      {aside && <div className="hr-ws-hero-aside">{aside}</div>}
      {facts && facts.length > 0 && (
        <dl className="hr-ws-facts">
          {facts.map((fact) => (
            <div key={fact.label} className={fact.tone && fact.tone !== 'default' ? `is-${fact.tone}` : undefined}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
              {fact.hint && <small>{fact.hint}</small>}
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

export type HrTabItem<K extends string> = { key: K; label: ReactNode; count?: number; icon?: IconType };

export function HrTabs<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  idPrefix,
  trailing,
}: {
  items: HrTabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  idPrefix: string;
  trailing?: ReactNode;
}) {
  return (
    <nav className="hr-ws-tabs-bar" aria-label={ariaLabel}>
      <div className="hr-ws-tabs" role="tablist" aria-label={ariaLabel}>
        {items.map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${key.toLowerCase()}`}
            aria-controls={`${idPrefix}-panel-${key.toLowerCase()}`}
            aria-selected={active === key}
            className={active === key ? 'active' : undefined}
            onClick={() => onChange(key)}
          >
            {Icon && <span className="hr-ws-tab-icon" aria-hidden="true"><Icon size={16} /></span>}
            <span>{label}</span>
            {count !== undefined && <small>{count}</small>}
          </button>
        ))}
      </div>
      {trailing && <div className="hr-ws-tabs-trailing">{trailing}</div>}
    </nav>
  );
}

export function HrToolbar({ children, ariaLabel, className = '' }: { children: ReactNode; ariaLabel?: string; className?: string }) {
  return <section className={`hr-ws-toolbar ${className}`.trim()} aria-label={ariaLabel}>{children}</section>;
}

export function HrSection({
  title,
  eyebrow,
  description,
  count,
  actions,
  children,
  flush = false,
  className = '',
  id,
  ...rest
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
  role?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}) {
  const hasHeader = title || description || actions || eyebrow;
  return (
    <section id={id} className={`hr-ws-section${flush ? ' is-flush' : ''} ${className}`.trim()} {...rest}>
      {hasHeader && (
        <header className="hr-ws-section-header">
          <div>
            {eyebrow && <span className="hr-ws-eyebrow">{eyebrow}</span>}
            {title && <h2>{title}{count !== undefined && <small>{count}</small>}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="hr-ws-section-actions">{actions}</div>}
        </header>
      )}
      <div className="hr-ws-section-body">{children}</div>
    </section>
  );
}

/** Two-column content: main column plus a sticky summary/aside column. */
export function HrSplit({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="hr-ws-split">
      <div className="hr-ws-split-main">{main}</div>
      <aside className="hr-ws-split-aside">{aside}</aside>
    </div>
  );
}
