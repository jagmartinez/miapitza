import type { HrPayrollRunStatus } from '../../types/hr-payroll';
import styles from './PayrollRunStepper.module.css';

const STEPS: Array<{ status: Exclude<HrPayrollRunStatus, 'VOID'>; label: string }> = [
  { status: 'DRAFT', label: 'Borrador' },
  { status: 'CALCULATED', label: 'Calculada' },
  { status: 'REVIEW', label: 'En revisión' },
  { status: 'APPROVED', label: 'Aprobada' },
  { status: 'PAID', label: 'Pagada' },
];

/** Etapa de la corrida: pasos completados, el actual (aria-current) y los pendientes. */
export default function PayrollRunStepper({ status }: { status: HrPayrollRunStatus }) {
  if (status === 'VOID') {
    return (
      <ol className={styles.stepper} aria-label="Estado de la corrida">
        <li className={`${styles.step} ${styles.voided}`} aria-current="step">Anulada</li>
      </ol>
    );
  }
  const current = STEPS.findIndex((step) => step.status === status);
  return (
    <ol className={styles.stepper} aria-label="Estado de la corrida">
      {STEPS.map((step, index) => {
        const state = index < current ? styles.done : index === current ? styles.current : '';
        return (
          <li key={step.status} className={`${styles.step} ${state}`.trim()} aria-current={index === current ? 'step' : undefined}>
            <span className={styles.index} aria-hidden="true">{index < current ? '✓' : index + 1}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
