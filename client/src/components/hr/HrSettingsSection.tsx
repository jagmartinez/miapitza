import type { ReactNode } from 'react';
import styles from './HrSettingsSection.module.css';

/**
 * Sección de configuración de RH con la estructura del mockup de Configuración:
 * tarjeta única con encabezado (grupo, título, descripción) y filas planas etiqueta/control.
 */
export function HrSettingsSection({
  id,
  group,
  title,
  description,
  actions,
  children,
}: {
  id?: string;
  group?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section className={styles.section} aria-labelledby={titleId} aria-label={titleId ? undefined : title}>
      <header className={styles.head}>
        <div className={styles.headText}>
          {group && <span className={styles.group}>{group}</span>}
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className={styles.headActions}>{actions}</div>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Fila etiqueta + descripción a la izquierda y control a la derecha; se apila en teléfono. */
export function HrSettingRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className={styles.rowLabel}>{label}</span>}
        {description && <p>{description}</p>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** Bloque de contenido libre dentro de una sección (avisos, listas, acciones). */
export function HrSettingsBlock({ children }: { children: ReactNode }) {
  return <div className={styles.block}>{children}</div>;
}
