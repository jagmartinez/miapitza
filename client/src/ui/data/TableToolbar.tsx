import type { ReactNode } from 'react';
import './data.css';

export function TableToolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ui-toolbar">
      <div className="ui-toolbar__filters">{children}</div>
      {actions ? <div className="ui-toolbar__actions">{actions}</div> : null}
    </div>
  );
}
