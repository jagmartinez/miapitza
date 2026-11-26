import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import './data.css';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty" role="status">
      {Icon ? <Icon size={32} aria-hidden="true" className="ui-empty__icon" /> : null}
      <p className="ui-empty__title">{title}</p>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}
