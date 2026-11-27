import { useLayoutEffect, useRef, useState, type FormEventHandler, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FormGrid, FormSection } from '@/ui';
import './HrControls.css';

const FOOTER_SLOT_ATTR = 'data-hr-modal-footer-slot';

/**
 * Marca dentro del pie de FullScreenModal (`footer`) donde HrModalFormShell coloca sus acciones.
 * Así Guardar/Cancelar viven en el pie del modal y no dentro del cuerpo con scroll.
 */
export function HrModalFooterSlot() {
  return <div {...{ [FOOTER_SLOT_ATTR]: '' }} className="hr-modal-footer-slot" />;
}

/**
 * Acciones de un formulario de RH. Si el modal declara <HrModalFooterSlot />, se pintan en el pie del modal
 * (el botón submit sigue enviando el formulario); si no, quedan al final del formulario.
 */
export function HrModalFormActions({ formRef, children }: { formRef: RefObject<HTMLFormElement | null>; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const form = formRef.current;
    const found = form?.closest('.ui-fsm')?.querySelector<HTMLElement>(`[${FOOTER_SLOT_ATTR}]`) ?? null;
    setSlot(found);
    if (!found || !form) return undefined;
    const onEnter = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'Enter' || target.tagName !== 'INPUT') return;
      const button = found.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!button || button.disabled) return;
      event.preventDefault();
      form.requestSubmit();
    };
    form.addEventListener('keydown', onEnter);
    return () => form.removeEventListener('keydown', onEnter);
  }, [formRef]);

  if (!slot) return <div className="hr-modal-form-footer">{children}</div>;

  const submitFromFooter = (event: MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[type="submit"]');
    if (!button || button.disabled) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };
  return createPortal(
    <div className="hr-modal-form-footer hr-modal-form-footer--modal" onClick={submitFromFooter}>{children}</div>,
    slot,
  );
}

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
 * una FormSection con FormGrid responsivo. Las acciones van al pie del modal (HrModalFooterSlot).
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
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} className={`hr-modal-form ${formClassName}`.trim()} aria-label={ariaLabel} onSubmit={onSubmit}>
      {notice}
      <FormSection title={sectionTitle}>
        <FormGrid>{children}</FormGrid>
      </FormSection>
      <HrModalFormActions formRef={formRef}>{footer}</HrModalFormActions>
    </form>
  );
}
