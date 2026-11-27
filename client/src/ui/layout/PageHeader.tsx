import type { ReactNode } from 'react';
import './layout.css';

/** Encabezado de página: título, subtítulo opcional y acciones a la derecha. Debajo van Tabs → TableToolbar → contenido. */
export function PageHeader({ title, description, subtitle, breadcrumb, actions }: {
  title: ReactNode;
  description?: ReactNode;
  /** Alias de `description`. */
  subtitle?: ReactNode;
  breadcrumb?: string[];
  actions?: ReactNode;
}) {
  const desc = description ?? subtitle;
  return (
    <header className="ui-pageheader">
      <div className="ui-pageheader__text">
        {breadcrumb?.length ? <p className="ui-pageheader__crumb">{breadcrumb.join(' / ')}</p> : null}
        <h1 className="ui-pageheader__title">{title}</h1>
        {desc ? <p className="ui-pageheader__desc">{desc}</p> : null}
      </div>
      {actions ? <div className="ui-pageheader__actions">{actions}</div> : null}
    </header>
  );
}
