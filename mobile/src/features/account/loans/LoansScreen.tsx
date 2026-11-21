import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHrMoney } from '@web/utils/hrFormat';
import type { HrLoan } from '@web/types/hr-benefits';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { useSessionRestored } from '../useSessionRestored';
import { toHrError, type HrApi } from '../hrApi';
import type { RequestCardModel } from '../useAccountSummary';
import { useCancelFlow } from '../requests/common';
import { cuotas } from './loanMath';
import { LOAN_STATUS_LABELS, LoanDetail } from './LoanDetail';
import '../requests/requests.css';

/** The list endpoint carries no balance: loans already disbursed get it from their detail. */
const HAS_BALANCE = new Set(['DISBURSED', 'ACTIVE']);

/** My loans and loan requests; opens the schedule detail and cancels a REQUESTED one. */
export function LoansScreen({ hr }: { hr: HrApi }) {
    const { back, navigate, params } = useAccountNav();
    const loanId = typeof params.loanId === 'number' ? params.loanId : null;
    const [loans, setLoans] = useState<HrLoan[] | null>(null);
    const [balances, setBalances] = useState<Record<number, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [balanceFailed, setBalanceFailed] = useState(false);
    // Ignores answers of a superseded load (reload, unmount).
    const gen = useRef(0);
    useEffect(() => () => void gen.current++, []);

    const load = useCallback(() => {
        const mine = ++gen.current;
        setError(null);
        setBalances({});
        setBalanceFailed(false);
        hr.myLoans().then(
            (rows) => {
                if (mine !== gen.current) return;
                setLoans(rows);
                rows.filter((l) => HAS_BALANCE.has(l.status)).forEach((l) => {
                    hr.myLoan(l.id).then(
                        (d) => mine === gen.current && setBalances((b) => ({ ...b, [l.id]: d.outstandingBalance })),
                        () => mine === gen.current && setBalanceFailed(true),
                    );
                });
            },
            (e) => mine === gen.current && setError(toHrError(e).message),
        );
    }, [hr]);
    useEffect(() => {
        if (loanId === null) load();
    }, [load, loanId]);

    useSessionRestored(() => {
        if (loanId === null && (error || balanceFailed)) load();
    });
    const cancel = useCancelFlow(hr, load);
    if (loanId !== null) return <LoanDetail hr={hr} id={loanId} />;

    const ask = (l: HrLoan) => {
        const model: RequestCardModel = {
            id: `loan-${l.id}`,
            kind: 'loan',
            refId: l.id,
            title: `Préstamo ${l.code}`,
            detail: formatHrMoney(l.currency, l.requestedAmount),
            status: l.status,
            statusLabel: LOAN_STATUS_LABELS[l.status] ?? l.status,
            tone: 'pending',
            cancellable: true,
            createdAt: l.requestedAt,
        };
        cancel.ask(model);
    };

    return (
        <main className="rq">
            <ScreenHeader title="Préstamos" onBack={back} />
            <div className="rq-form">
                <button type="button" className="btn btn-primary" onClick={() => navigate('loanRequest')}>
                    Solicitar préstamo
                </button>
                {error && (
                    <p className="error" role="alert">
                        {error} <button type="button" className="ah-link" onClick={load}>Reintentar</button>
                    </p>
                )}
                {balanceFailed && (
                    <p className="error" role="alert">
                        No se pudo cargar el saldo de algún préstamo. <button type="button" className="ah-link" onClick={load}>Reintentar</button>
                    </p>
                )}
                {!loans && !error && <p className="muted">Cargando…</p>}
                {loans && !loans.length && <p className="muted">Aún no tienes préstamos.</p>}
                {loans?.map((l) => (
                    <Card
                        key={l.id}
                        title={`${l.code} · ${formatHrMoney(l.currency, l.approvedAmount ?? l.requestedAmount)}`}
                        badge={LOAN_STATUS_LABELS[l.status] ?? l.status}
                        badgeTone={l.status === 'REQUESTED' ? 'pending' : l.status === 'REJECTED' ? 'rejected' : 'neutral'}
                        onClick={l.status === 'REQUESTED' ? undefined : () => navigate('loans', { loanId: l.id })}
                    >
                        <span>
                            {cuotas(l.installmentCount)}{balances[l.id] != null && <> · Saldo {formatHrMoney(l.currency, balances[l.id])}</>}
                        </span>
                        {l.status === 'REQUESTED' && (
                            <button type="button" className="btn ah-cancel" onClick={() => ask(l)}>
                                Cancelar solicitud
                            </button>
                        )}
                    </Card>
                ))}
            </div>
            {cancel.sheet}
        </main>
    );
}
