import type { FormEventHandler, ReactNode } from 'react';
import { FormGrid, FormSection } from '@/ui';
import './HrControls.css';

interface HrModalFormShellProps {
  ariaLabel: string;
  /** Se conserva por compatibilidad: el título del modal lo da FullScreenModal. */
  tabLabel?: string;
  sectionTitle: string;
  icon?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  formClassName?: string;
  notice?: ReactNode;
}

/**
 * Cuerpo canónico de los formularios de RH dentro de FullScreenModal:
 * una FormSection con FormGrid responsivo y un pie de acciones que envuelve en pantallas angostas.
 */
export default function HrModalFormShell({
  ariaLabel,
  sectionTitle,
  children,
  footer,
  onSubmit,
  formClassName = '',
  notice,
}: HrModalFormShellProps) {
  return (
    <form className={`hr-modal-form ${formClassName}`.trim()} aria-label={ariaLabel} onSubmit={onSubmit}>
      {notice}
      <FormSection title={sectionTitle}>
        <FormGrid>{children}</FormGrid>
      </FormSection>
      <div className="hr-modal-form-footer">{footer}</div>
    </form>
  );
}
