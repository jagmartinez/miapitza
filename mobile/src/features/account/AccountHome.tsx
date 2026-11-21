import { ATTENDANCE_ACTION_LABELS } from '@web/components/hr/attendanceRules';
import { formatHrMoney, formatHrNumber } from '@web/utils/hrFormat';
import { isCompanyAdmin, isWaiter } from '../../core/permissions';
import type { Session } from '../../core/session';
import { Card } from '../../ui/Card';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { useAccountNav, type AccountSection } from './AccountNav';
import type { HrApi } from './hrApi';
import { useMyService } from './useMyService';
import { useCancelFlow } from './requests/common';
import { PART_LABELS, useAccountSummary, type PendingItem } from './useAccountSummary';
import './account-home.css';

interface Props {
    session: Session;
    hr: HrApi;
    onLogout: () => void;
}

const UNLINKED = 'Tu usuario no está vinculado a un empleado. Pide a RH que lo vincule.';

const PENDING_SECTION: Record<PendingItem['kind'], AccountSection> = { schedule: 'schedule', receipt: 'payroll', swap: 'pending' };

export function AccountHome({ session, hr, onLogout }: Props) {
    const { navigate } = useAccountNav();
    const linked = session.user.accountType === 'INTERNAL' && session.user.employeeId != null;
    const summary = useAccountSummary(hr, { userId: session.user.id, enabled: linked });
    const service = useMyService(hr, linked && isWaiter(session.user));
    const cancel = useCancelFlow(hr, summary.reload);

    const header = <ScreenHeader title={session.user.name} right={<button type="button" className="btn ah-logout" onClick={onLogout}>Salir</button>} />;

    if (!linked) {
        return (
            <main className="ah">
                {header}
                <div className="ah-body">
                    <p className="muted">{UNLINKED}</p>
                    <Card title="Mi información" onClick={() => navigate('info')} />
                    {isCompanyAdmin(session.user) && <Card title="Por aprobar" onClick={() => navigate('approvals')} />}
                </div>
            </main>
        );
    }

    const { today, vacation, loanPolicy } = summary;
    const actions = today?.availableActions ?? [];
    const stale = today?.blockingIssue?.code === 'STALE_OPEN_ATTENDANCE';
    const facePending = summary.biometric?.status === 'PENDING' && today?.policy?.requireBiometric !== false;
    const loanDatum = !loanPolicy?.eligible ? 'No disponible' : loanPolicy.maxAmount != null ? `Hasta ${formatHrMoney(loanPolicy.currency, loanPolicy.maxAmount)}` : 'Disponible';
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
                        ) : actions.length > 0 ? (
                            actions.map((action, i) => (
                                <button key={action} type="button" className={`btn ${i === 0 ? 'btn-primary ' : ''}ah-wide`} onClick={() => navigate('punch', { action })}>
                                    {ATTENDANCE_ACTION_LABELS[action]}
                                </button>
                            ))
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
                        <button type="button" className="ah-link" onClick={() => navigate('requests')}>Ver todas</button>
                        <div className="ah-list">
                            {summary.myRequests.map((r) => (
                                <Card key={r.id} title={r.title} badge={r.statusLabel} badgeTone={r.tone}>
                                    <span>{r.detail}</span>
                                    {r.cancellable && (
                                        <button type="button" className="btn ah-cancel" onClick={() => cancel.ask(r)}>
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
                    {isWaiter(session.user) && (
                        <Card title="Mi servicio">
                            {service.error ? (
                                <p className="error" role="alert">
                                    No se pudo cargar tu servicio. <button type="button" className="ah-link" onClick={service.reload}>Reintentar</button>
                                </p>
                            ) : !service.data ? (
                                <p className="muted">Cargando…</p>
                            ) : service.data.attentionAvg == null || service.data.nps == null ? (
                                <p className="muted">Aún no hay suficientes opiniones este mes</p>
                            ) : (
                                <>
                                    <p>Atención {service.data.attentionAvg.toFixed(1)} · NPS {service.data.nps}</p>
                                    {service.data.rank != null && <p className="muted">Puesto {service.data.rank} de {service.data.rankedCount}</p>}
                                </>
                            )}
                        </Card>
                    )}
                    <Card title="Mi horario" onClick={() => navigate('schedule')} />
                    <Card title="Mi nómina" onClick={() => navigate('payroll')} />
                    <Card title="Préstamos" onClick={() => navigate('loans')} />
                    <Card title="Mi información" onClick={() => navigate('info')} />
                    {isCompanyAdmin(session.user) && <Card title="Por aprobar" onClick={() => navigate('approvals')} />}
                </div>
            </div>
            {cancel.sheet}
        </main>
    );
}
