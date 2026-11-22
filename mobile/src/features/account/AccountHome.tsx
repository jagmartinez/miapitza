import { ATTENDANCE_ACTION_LABELS } from '@web/components/hr/attendanceRules';
import { formatHrMoney, formatHrNumber } from '@web/utils/hrFormat';
import { isCompanyAdmin, isWaiter } from '../../core/permissions';
import type { Session } from '../../core/session';
import { Card } from '../../ui/Card';
import { IconArrowsExchange, IconBeach, IconBuildingBank, IconCash, IconChevronRight, IconClipboardCheck, IconClipboardList, IconClockPlus, IconEdit, IconFileInvoice, IconFingerprint, IconUser, type TablerIcon } from '../../ui/Icon';
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

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

/** "4:00 p. m. – 11:00 p. m." in the branch's own timezone. */
function shiftRange(startAt: string, endAt: string, timeZone?: string): string | null {
    try {
        const f = new Intl.DateTimeFormat('es-NI', { hour: 'numeric', minute: '2-digit', timeZone });
        return `${f.format(new Date(startAt))} – ${f.format(new Date(endAt))}`;
    } catch {
        return null;
    }
}

const PENDING_SECTION: Record<PendingItem['kind'], AccountSection> = { schedule: 'schedule', receipt: 'payroll', swap: 'pending' };

function NavRow({ icon: Icon, title, onClick }: { icon: TablerIcon; title: string; onClick: () => void }) {
    return (
        <button type="button" className="ah-tile ah-tile-row ah-navrow" onClick={onClick}>
            <Icon size={20} stroke={1.5} aria-hidden />
            <span className="ah-tile-text"><b>{title}</b></span>
            <IconChevronRight size={18} stroke={1.5} aria-hidden />
        </button>
    );
}

export function AccountHome({ session, hr, onLogout }: Props) {
    const { navigate } = useAccountNav();
    const linked = session.user.accountType === 'INTERNAL' && session.user.employeeId != null;
    const summary = useAccountSummary(hr, { userId: session.user.id, enabled: linked });
    const service = useMyService(hr, linked && isWaiter(session.user));
    const cancel = useCancelFlow(hr, summary.reload);

    const header = (
        <header className="ah-top">
            <span className="ah-hello">Hola, {firstName(session.user.name)}</span>
            <button type="button" className="ah-logout" onClick={onLogout}>Salir</button>
        </header>
    );

    if (!linked) {
        return (
            <main className="ah">
                {header}
                <div className="ah-body">
                    <p className="muted">{UNLINKED}</p>
                    <NavRow icon={IconUser} title="Mi información" onClick={() => navigate('info')} />
                    {isCompanyAdmin(session.user) && <NavRow icon={IconClipboardCheck} title="Por aprobar" onClick={() => navigate('approvals')} />}
                </div>
            </main>
        );
    }

    const { today, vacation, loanPolicy } = summary;
    const actions = today?.availableActions ?? [];
    const stale = today?.blockingIssue?.code === 'STALE_OPEN_ATTENDANCE';
    const facePending = summary.biometric?.status === 'PENDING' && today?.policy?.requireBiometric !== false;
    const shift = today?.scheduledShift ? shiftRange(today.scheduledShift.startAt, today.scheduledShift.endAt, today.timezone) : null;
    const branchLine = today?.targetBranch?.name ? `Marcaje en ${today.targetBranch.name}` : null;
    const loanDatum = !loanPolicy && summary.failed.includes('loanPolicy')
        ? 'No se pudo cargar'
        : !loanPolicy && summary.status !== 'ready' && summary.status !== 'error'
          ? 'Cargando…'
          : !loanPolicy?.eligible ? 'No disponible' : loanPolicy.maxAmount != null ? `Hasta ${formatHrMoney(loanPolicy.currency, loanPolicy.maxAmount)}` : 'Disponible';
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

                <section aria-label="Marcar" className="ah-punch">
                    {shift && <p className="ah-shift">Turno {shift}</p>}
                    {summary.status === 'loading' && !today && <p className="muted">Cargando…</p>}
                    {!today && summary.failed.includes('today') ? (
                        <p className="error" role="alert">
                            No se pudo cargar tu marcaje. <button type="button" className="ah-link" onClick={summary.reload}>Reintentar</button>
                        </p>
                    ) : stale ? (
                        <>
                            <p>Tienes una jornada abierta sin cerrar</p>
                            <button type="button" className="btn btn-primary ah-wide ah-mark" onClick={() => navigate('correction', { stale: true })}>
                                Corregir marcaje
                            </button>
                        </>
                    ) : facePending ? (
                        <p className="muted">Registro facial pendiente de aprobación</p>
                    ) : actions.length > 0 ? (
                        actions.map((action, i) => (
                            <button key={action} type="button" className={`btn ${i === 0 ? 'btn-primary ah-mark' : ''} ah-wide`} onClick={() => navigate('punch', { action })}>
                                {i === 0 && <IconFingerprint size={20} stroke={1.5} aria-hidden />}
                                {i === 0 && (action === 'CHECK_IN' || action === 'CHECK_OUT') ? `Marcar ${ATTENDANCE_ACTION_LABELS[action].toLowerCase()}` : ATTENDANCE_ACTION_LABELS[action]}
                            </button>
                        ))
                    ) : (
                        today && <p className="muted">No tienes marcajes disponibles ahora.</p>
                    )}
                    {branchLine && actions.length > 0 && !stale && !facePending && <p className="ah-geo">{branchLine}</p>}
                </section>

                <h2 className="ah-h">Solicitar</h2>
                <div className="ah-grid">
                    <button type="button" className="ah-tile" onClick={() => navigate('leave')}>
                        <IconBeach size={20} stroke={1.5} aria-hidden />
                        <b>Permiso</b>
                        <span>{vacationDatum}</span>
                    </button>
                    <button type="button" className="ah-tile" onClick={() => navigate('loanRequest')}>
                        <IconCash size={20} stroke={1.5} aria-hidden />
                        <b>Préstamo</b>
                        <span>{loanDatum}</span>
                    </button>
                    <button type="button" className="ah-tile" onClick={() => navigate('overtime')}>
                        <IconClockPlus size={20} stroke={1.5} aria-hidden />
                        <b>Horas extra</b>
                        <span>Registrar tiempo</span>
                    </button>
                    <button type="button" className="ah-tile" onClick={() => navigate('swap')}>
                        <IconArrowsExchange size={20} stroke={1.5} aria-hidden />
                        <b>Cambio de turno</b>
                        <span>Con un compañero</span>
                    </button>
                    <button type="button" className="ah-tile ah-tile-row" onClick={() => navigate('correction')}>
                        <IconEdit size={20} stroke={1.5} aria-hidden />
                        <span className="ah-tile-text">
                            <b>Corregir marcaje</b>
                            <span>Olvidé marcar o hubo un error</span>
                        </span>
                        <IconChevronRight size={18} stroke={1.5} aria-hidden />
                    </button>
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
                        <button type="button" className="ah-link ah-all" onClick={() => navigate('requests')}>Ver todas</button>
                        <div className="ah-list">
                            {summary.myRequests.map((r) => (
                                <section key={r.id} className="ah-req">
                                    <div className="ah-req-head">
                                        <b>{r.title}</b>
                                        <span className={`ah-status ah-status-${r.tone}`}>{r.statusLabel}</span>
                                    </div>
                                    <span className="ah-req-detail">{r.detail}</span>
                                    {r.cancellable && (
                                        <button type="button" className="ah-req-cancel" onClick={() => cancel.ask(r)}>
                                            Cancelar solicitud
                                        </button>
                                    )}
                                </section>
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
                    <NavRow icon={IconClipboardList} title="Mi horario" onClick={() => navigate('schedule')} />
                    <NavRow icon={IconFileInvoice} title="Mi nómina" onClick={() => navigate('payroll')} />
                    <NavRow icon={IconBuildingBank} title="Préstamos" onClick={() => navigate('loans')} />
                    <NavRow icon={IconUser} title="Mi información" onClick={() => navigate('info')} />
                    {isCompanyAdmin(session.user) && <NavRow icon={IconClipboardCheck} title="Por aprobar" onClick={() => navigate('approvals')} />}
                </div>
            </div>
            {cancel.sheet}
        </main>
    );
}
