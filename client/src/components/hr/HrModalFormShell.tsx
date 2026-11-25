import { useId, type FormEventHandler, type ReactNode } from 'react';
import './HrControls.css';

interface HrModalFormShellProps {
  ariaLabel: string;
  tabLabel: string;
  sectionTitle: string;
  icon: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  formClassName?: string;
  notice?: ReactNode;
}

/**
 * Canonical RH form layout. It deliberately mirrors the reservation and
 * supervised-attendance dialogs: context rail, one scroll owner and a fixed
 * action footer. Keeping this structure shared prevents individual RH forms
 * from drifting back to the legacy padded-grid sidebar layout.
 */
export default function HrModalFormShell({
  ariaLabel,
  tabLabel,
  sectionTitle,
  icon,
  children,
  footer,
  onSubmit,
  formClassName = '',
  notice,
}: HrModalFormShellProps) {
  const shellId = useId().replace(/:/g, '');
  const tabId = `${shellId}-tab`;
  const panelId = `${shellId}-panel`;

  return (
    <div className="premium-modal-content hr-flow-modal-content">
      <div className="modal-tabs" role="tablist" aria-label={ariaLabel}>
        <button type="button" role="tab" id={tabId} aria-controls={panelId} aria-selected="true" className="modal-tab active">
          {icon}
          <span>{tabLabel}</span>
        </button>
      </div>
      <form className={`modal-form-new hr-modal-form ${formClassName}`.trim()} onSubmit={onSubmit}>
        <div className="modal-tab-content" id={panelId} role="tabpanel" aria-labelledby={tabId} tabIndex={0}>
          {notice}
          <section className="modal-content-group">
            <div className="modal-section-header">
              {icon}
              <h3>{sectionTitle}</h3>
            </div>
            <div className="hr-modal-form-grid">{children}</div>
          </section>
        </div>
        <div className="modal-footer">{footer}</div>
      </form>
    </div>
  );
}
