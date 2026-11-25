import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import './forms.css';

type Props = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
};

export function Field({ label, htmlFor, hint, error, required, children }: Props) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const content = Children.map(children, (child) => {
    // Solo se inyectan atributos ARIA en componentes (los elementos DOM nativos no se tocan).
    if (isValidElement(child) && typeof child.type !== 'string') {
      const extra: Record<string, unknown> = {};
      if (error) extra['aria-invalid'] = true;
      if (describedBy) extra['aria-describedby'] = describedBy;
      return cloneElement(child as ReactElement<Record<string, unknown>>, extra);
    }
    return child;
  });

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </label>
      {content}
      {hint && !error && (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
