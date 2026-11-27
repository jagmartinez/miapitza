import type { ReactNode } from 'react';
import './forms.css';

type Props = {
  title: string;
  description?: string;
  step?: number;
  /** Acciones inmediatas de la sección; se alinean a la derecha de la cabecera. */
  actions?: ReactNode;
  children: ReactNode;
};

export function FormSection({ title, description, step, actions, children }: Props) {
  return (
    <section className="ui-form-section">
      <header className="ui-form-section__head">
        {step !== undefined && <span className="ui-form-section__step" aria-hidden="true">{step}</span>}
        <div className="ui-form-section__heading">
          <h3 className="ui-form-section__title">{title}</h3>
          {description && <p className="ui-form-section__desc">{description}</p>}
        </div>
        {actions && <div className="ui-form-section__actions">{actions}</div>}
      </header>
      <div className="ui-form-section__body">{children}</div>
    </section>
  );
}
