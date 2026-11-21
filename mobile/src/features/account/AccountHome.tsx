import { useRef, useState } from 'react';
import { ATTENDANCE_ACTION_LABELS } from '@web/components/hr/attendanceRules';
import { formatHrMoney, formatHrNumber } from '@web/utils/hrFormat';
import { isCompanyAdmin } from '../../core/permissions';
import type { Session } from '../../core/session';
import { Card } from '../../ui/Card';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { useToast } from '../../ui/Toast';
import { useAccountNav, type AccountSection } from './AccountNav';
import type { HrApi } from './hrApi';
import { toHrError } from './hrApi';
import { PART_LABELS, useAccountSummary, type PendingItem, type RequestCardModel } from './useAccountSummary';
import './account-home.css';

interface Props {
    session: Session;
    hr: HrApi;
    onLogout: () => void;
}

const UNLINKED = 'Tu usuario no está vinculado a un empleado. Pide a RH que lo vincule.';
const CANCEL_REASON = 'Cancelada por el empleado';

const PENDING_SECTION: Record<PendingItem['kind'], AccountSection> = { schedule: 'schedule', receipt: 'payroll', swap: 'swap' };

export function AccountHome({ session, hr, onLogout }: Props) {
    const { navigate } = useAccountNav();
    const toast = useToast();
    const linked = session.user.accountType === 'INTERNAL' && session.user.employeeId != null;
    const summary = useAccountSummary(hr, { userId: session.user.id, enabled: linked });
    const busy = useRef(new Set<string>());
    const [, force] = useState(0);

    async function cancel(r: RequestCardModel) {
        if (busy.current.has(r.id)) return;
        busy.current.add(r.id);
        force((n) => n + 1);
        const opts = { actionId: `cancel-${r.id}` };
        try {
            if (r.kind === 'leave') await hr.cancelLeave(r.refId, CANCEL_REASON, opts);
            else if (r.kind === 'overtime') await hr.cancelOvertime(r.refId, CANCEL_REASON, opts);
            else if (r.kind === 'correction') await hr.cancelCorrection(r.refId, CANCEL_REASON, opts);
            else if (r.kind === 'swap') await hr.cancelSwap(r.refId);
            else await hr.cancelLoanRequest(r.refId, undefined, opts);
            toast.show('Solicitud cancelada');
            summary.reload();
        } catch (e) {
            toast.show(toHrError(e).message, 'error');
        } finally {
            busy.current.delete(r.id);
            force((n) => n + 1);
        }
    }

    const header = <ScreenHeader title={session.user.name} right={<button type="button" className="btn ah-logout" onClick={onLogout}>Salir</button>} />;

    if (!linked) {
        return (
            <main className="ah">
                {header}
                <div className="ah-body">
                    <p className="muted">{UNLINKED}</p>
                    <Card title="Mi información" onClick={() => navigate('info')} />
                </div>
            </main>
        );
    }

    const { today, vacation, loanPolicy } = summary;
    const action = today?.availableActions?.[0];
    const stale = today?.blockingIssue?.code === 'STALE_OPEN_ATTENDANCE';
    const facePending = summary.biometric?.status === 'PENDING' && today?.policy?.requireBiometric !== false;
    const loanDatum = loanPolicy?.eligible && loanPolicy.maxAmount != null ? `Hasta ${formatHrMoney(loanPolicy.currency, loanPolicy.maxAmount)}` : 'No disponible';
    const vacationDatum = vacation ? `${formatHrNumber(vacation.available)} días disponibles` : 'Sin saldo';

    return (
        <main className="ah">
            {header}
            <div className="ah-body">
                {summary.failed
                    .filter((p) => p !== 'today')
                    .map((p) => (
                        <p key={p} className="error" role="alert">
                            No se pudo cargar {PART_LABELS[p]}. <button type="button" className="ah-link" onClick={summary.reload}>Reintentar</button>
                        </p>
                    ))}

                <section aria-label="Marcar">
                    <Card title="Marcar">
                        {summary.status === 'loading' && !today && <p className="muted">Cargando…</p>}
                        {!today && summary.failed.includes('today') ? (
                            <p className="error" role="alert">
                                No se pudo cargar tu marcaje. <button type="button" className="ah-link" onClick={summary.reload}>Reintentar</button>
                            </p>
                        ) : stale ? (
                            <>
                                <p>Tienes una jornada abierta sin cerrar</p>
                                <button type="button" className="btn btn-primary ah-wide" onClick={() => navigate('correction', { stale: true })}>
                                    Corregir marcaje
                                </button>
                            </>
                        ) : facePending ? (
                            <p className="muted">Registro facial pendiente de aprobación</p>
                        ) : action ? (
                            <button type="button" className="btn btn-primary ah-wide" onClick={() => navigate('punch', { action })}>
                                {ATTENDANCE_ACTION_LABELS[action]}
                            </button>
                        ) : (
                            today && <p className="muted">No tienes marcajes disponibles ahora.</p>
                        )}
                    </Card>
                </section>

                <h2 className="ah-h">Solicitar</h2>
                <div className="ah-grid">
                    <Card title="Permiso / vacaciones" onClick={() => navigate('leave')}>{vacationDatum}</Card>
                    <Card title="Horas extra" onClick={() => navigate('overtime')} />
                    <Card title="Corregir marcaje" onClick={() => navigate('correction')} />
                    <Card title="Cambio de turno" onClick={() => navigate('swap')} />
                    <Card title="Préstamo" onClick={() => navigate('loanRequest')}>{loanDatum}</Card>
                </div>

                {summary.pendingForYou.length > 0 && (
                    <>
                        <h2 className="ah-h">Pendiente para ti</h2>
                        <div className="ah-list">
                            {summary.pendingForYou.map((p) => (
                                <Card key={p.id} title={p.title} badge="Pendiente" badgeTone="pending" onClick={() => navigate(PENDING_SECTION[p.kind], { refId: p.refId })}>
                                    {p.detail}
                                </Card>
                            ))}
                        </div>
                    </>
                )}

                {summary.myRequests.length > 0 && (
                    <>
                        <h2 className="ah-h">Mis solicitudes</h2>
                        <div className="ah-list">
                            {summary.myRequests.map((r) => (
                                <Card key={r.id} title={r.title} badge={r.statusLabel} badgeTone={r.tone}>
                                    <span>{r.detail}</span>
                                    {r.cancellable && (
                                        <button type="button" className="btn ah-cancel" disabled={busy.current.has(r.id)} onClick={() => void cancel(r)}>
                                            Cancelar
                                        </button>
                                    )}
                                </Card>
                            ))}
                        </div>
                    </>
                )}

                <h2 className="ah-h">Mi espacio</h2>
                <div className="ah-list">
                    <Card title="Mi horario" onClick={() => navigate('schedule')} />
                    <Card title="Mi nómina" onClick={() => navigate('payroll')} />
                    <Card title="Préstamos" onClick={() => navigate('loans')} />
                    <Card title="Mi información" onClick={() => navigate('info')} />
                    {isCompanyAdmin(session.user) && <Card title="Por aprobar" onClick={() => navigate('approvals')} />}
                </div>
            </div>
        </main>
    );
}
