import type { ReactNode } from 'react';
import './layout.css';

/** Contenedor de página: ancho máximo y espaciado uniformes. */
export function PageContent({ children, maxWidth = 1700 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="ui-pagecontent" style={{ maxWidth }}>
      {children}
    </div>
  );
}
