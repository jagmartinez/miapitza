import { useCallback, useEffect, useState } from 'react';
import { formatHrDecimalInput, normalizeHrDecimalInput } from '@web/components/hr/hrMoneyInputFormat';
import { formatHrMoney } from '@web/utils/hrFormat';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { toHrError, type HrApi, type HrLoanPolicy } from '../hrApi';
import { Field, FormScreen, useRequestSubmit } from '../requests/common';
import { cuotas, fromCents, installmentPlan, toCents } from './loanMath';

export const PURPOSE_MAX = 900;
const SERVER_MAX_INSTALLMENTS = 120;

function ineligibleMessage(p: HrLoanPolicy): string {
    if (p.ineligibleReason === 'HR_LOAN_POLICY_DISABLED') return 'Los préstamos no están habilitados en este momento.';
    if (p.ineligibleReason === 'HR_LOAN_TENURE_POLICY' || (p.minTenureMonths != null && p.tenureMonths != null && p.tenureMonths < p.minTenureMonths)) {
        return p.minTenureMonths != null ? `Aún no cumples la antigüedad mínima de ${p.minTenureMonths} meses.` : 'Aún no cumples la antigüedad mínima requerida.';
    }
    return 'Por ahora no puedes solicitar un préstamo.';
}

/** Loan request: single screen with the policy limits and the live installment line. */
export function LoanRequestForm({ hr }: { hr: HrApi }) {
    const { back } = useAccountNav();
    const { busy, error, submit } = useRequestSubmit();
    const [policy, setPolicy] = useState<HrLoanPolicy | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [amount, setAmount] = useState('');
    const [count, setCount] = useState('');
    const [purpose, setPurpose] = useState('');
    const [payroll, setPayroll] = useState(true);

    const load = useCallback(() => {
        setLoadError(null);
        hr.loanPolicy().then(setPolicy, (e) => setLoadError(toHrError(e).message));
    }, [hr]);
    useEffect(load, [load]);

    if (!policy) {
        return (
            <main className="rq">
                <ScreenHeader title="Solicitar préstamo" onBack={back} />
                <div className="rq-form">
                    {loadError ? (
                        <p className="error" role="alert">
                            {loadError} <button type="button" className="ah-link" onClick={load}>Reintentar</button>
                        </p>
                    ) : (
                        <p className="muted">Cargando…</p>
                    )}
                </div>
            </main>
        );
    }
    if (!policy.eligible) {
        return (
            <main className="rq">
                <ScreenHeader title="Solicitar préstamo" onBack={back} />
                <div className="rq-form">
                    <p className="muted">{ineligibleMessage(policy)}</p>
                </div>
            </main>
        );
    }

    const cents = toCents(amount);
    const maxCents = policy.maxAmount != null ? toCents(String(policy.maxAmount)) : null;
    const maxCount = Math.min(policy.maxInstallments ?? SERVER_MAX_INSTALLMENTS, SERVER_MAX_INSTALLMENTS);
    const n = Number(count);
    const amountOk = cents !== null && cents > 0 && (maxCents === null || cents <= maxCents);
    const countOk = count !== '' && Number.isInteger(n) && n >= 1 && n <= maxCount;
    const trimmed = purpose.trim();
    const canSubmit = amountOk && countOk && trimmed.length >= 1 && trimmed.length <= PURPOSE_MAX;
    const plan = amountOk && countOk ? installmentPlan(amount, n) : [];
    const money = (v: string) => formatHrMoney(policy.currency, v);

    return (
        <FormScreen
            title="Solicitar préstamo"
            canSubmit={canSubmit}
            busy={busy}
            error={error}
            onSubmit={() =>
                void submit((action) =>
                    hr.requestLoan(
                        { purpose: trimmed, currency: policy.currency, requestedAmount: fromCents(cents!), preferredInstallments: n, payrollDeductionRequested: payroll },
                        action,
                    ),
                )
            }
        >
            <Field label="Monto">
                <input type="text" inputMode="decimal" value={formatHrDecimalInput(amount)} onChange={(e) => setAmount(normalizeHrDecimalInput(e.target.value))} />
            </Field>
            {maxCents !== null && <p className="muted">Máximo {money(String(policy.maxAmount))}</p>}
            {amount !== '' && (cents === null || cents <= 0) && (
                <p className="pf-error" role="alert">
                    Ingresa un monto mayor que 0.
                </p>
            )}
            {cents !== null && maxCents !== null && cents > maxCents && (
                <p className="pf-error" role="alert">
                    El monto supera el máximo permitido.
                </p>
            )}
            <Field label="Cuotas">
                <input type="number" inputMode="numeric" min={1} max={maxCount} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            {count !== '' && (!Number.isInteger(n) || n < 1) && (
                <p className="pf-error" role="alert">
                    Ingresa al menos 1 cuota.
                </p>
            )}
            {count !== '' && Number.isInteger(n) && n > maxCount && (
                <p className="pf-error" role="alert">
                    Máximo {maxCount} cuotas.
                </p>
            )}
            <p className="muted">Entre 1 y {maxCount} cuotas.</p>
            {plan.length > 0 && (
                <p className="rq-info">
                    {cuotas(plan.length)} de {money(plan[0])} (última {money(plan[plan.length - 1])})
                </p>
            )}
            {policy.maxPaymentPercent != null && <p className="muted">Máximo {Number(policy.maxPaymentPercent)}% de tu salario por cuota</p>}
            <Field label="Motivo">
                <textarea className="rq-text" rows={3} maxLength={PURPOSE_MAX} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </Field>
            <label className="field">
                <input type="checkbox" checked={payroll} onChange={(e) => setPayroll(e.target.checked)} /> Descontar de planilla
            </label>
        </FormScreen>
    );
}
