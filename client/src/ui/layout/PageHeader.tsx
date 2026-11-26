import type { ReactNode } from 'react';
import './layout.css';

export function PageHeader({ title, description, breadcrumb, actions }: {
  title: string;
  description?: ReactNode;
  breadcrumb?: string[];
  actions?: ReactNode;
}) {
  return (
    <header className="ui-pageheader">
      <div className="ui-pageheader__text">
        {breadcrumb?.length ? <p className="ui-pageheader__crumb">{breadcrumb.join(' / ')}</p> : null}
        <h1 className="ui-pageheader__title">{title}</h1>
        {description ? <p className="ui-pageheader__desc">{description}</p> : null}
      </div>
      {actions ? <div className="ui-pageheader__actions">{actions}</div> : null}
    </header>
  );
}
