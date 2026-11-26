import type { ReactNode } from 'react';
import './forms.css';

export function FormGrid({
  columns = 'repeat(auto-fit, minmax(16rem, 1fr))',
  children,
}: {
  columns?: string;
  children: ReactNode;
}) {
  return (
    <div className="ui-form-grid" style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}
