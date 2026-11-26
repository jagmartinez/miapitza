import { useCallback, useEffect, useState } from 'react';
import { formatHrMoney } from '@web/utils/hrFormat';
import type { HrLoan, HrLoanInstallment } from '@web/types/hr-benefits';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { dateOnly } from '../format';
import { cuotas } from './loanMath';
import { toHrError, type HrApi } from '../hrApi';
import '../requests/requests.css';

export const LOAN_STATUS_LABELS: Record<string, string> = {
    REQUESTED: 'Solicitado',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    DISBURSED: 'Desembolsado',
    ACTIVE: 'Activo',
    PAID: 'Pagado',
    CLOSED: 'Cerrado',
    CANCELLED: 'Cancelado',
    REVERSED: 'Revertido',
};

const INSTALLMENT_LABELS: Record<HrLoanInstallment['status'], string> = {
    PENDING: 'Pendiente',
    PARTIAL: 'Parcial',
    PAID: 'Pagada',
    OVERDUE: 'Vencida',
    CANCELLED: 'Cancelada',
};

const dateLabel = (d: string) => dateOnly(d) || d;

/** One loan with its installment schedule; OVERDUE installments get the soft red chip. */
export function LoanDetail({ hr, id }: { hr: HrApi; id: number }) {
    const { back } = useAccountNav();
    const [loan, setLoan] = useState<HrLoan | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setError(null);
        hr.myLoan(id).then(setLoan, (e) => setError(toHrError(e).message));
    }, [hr, id]);
    useEffect(load, [load]);

    return (
        <main className="rq">
            <ScreenHeader title={loan?.code ?? 'Préstamo'} onBack={back} />
            <div className="rq-form">
                {error && (
                    <p className="error" role="alert">
                        {error} <button type="button" className="ah-link" onClick={load}>Reintentar</button>
                    </p>
                )}
                {!loan && !error && <p className="muted">Cargando…</p>}
                {loan && (
                    <>
                        <Card title={formatHrMoney(loan.currency, loan.approvedAmount ?? loan.requestedAmount)} badge={LOAN_STATUS_LABELS[loan.status] ?? loan.status}>
                            <span>
                                Saldo {formatHrMoney(loan.currency, loan.outstandingBalance)} · {cuotas(loan.installmentCount)}
                            </span>
                        </Card>
                        {!loan.schedule?.length && <p className="muted">Aún no hay calendario de cuotas.</p>}
                        {loan.schedule?.map((s) => (
                            <Card
                                key={s.id}
                                title={`Cuota ${s.number} · ${dateLabel(s.dueDate)}`}
                                badge={INSTALLMENT_LABELS[s.status] ?? s.status}
                                badgeTone={s.status === 'OVERDUE' ? 'rejected' : 'neutral'}
                            >
                                <span>
                                    {formatHrMoney(loan.currency, s.scheduledTotal)} · Pagado {formatHrMoney(loan.currency, s.paidAmount)} · Pendiente {formatHrMoney(loan.currency, s.outstandingAmount)}
                                </span>
                            </Card>
                        ))}
                    </>
                )}
            </div>
        </main>
    );
}
