import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatHrNumber } from '../../utils/hrDisplay';
import {
  AlertTriangle,
  Briefcase as BriefcaseBusiness,
  CalendarPlus,
  Clock3,
  ClipboardList as FilePenLine,
  Plus,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { FullScreenModal, Button } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import AttendanceCorrectionForm from '../../components/hr/AttendanceCorrectionForm';
import LeaveRequestForm from '../../components/hr/LeaveRequestForm';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import OvertimeRequestForm from '../../components/hr/OvertimeRequestForm';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import WorkforceStatusPill from '../../components/hr/WorkforceStatusPill';
import {
  createWorkforceIdempotencyKey,
  getWorkforceErrorMessage,
  workforceClient,
} from '../../components/hr/workforceClient';
import { HrHero, HrPage, HrSection, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
import { selectVacationBalance } from '../../components/hr/vacationBalance';
import { useAppToast } from '../../context/ToastContext';
import type {
  HrAttendanceCorrection,
  HrAttendanceCorrectionPayload,
  HrAttendanceIncident,
  HrDailyAttendanceSummary,
  HrLeaveRequest,
  HrLeaveRequestPayload,
  HrLeaveType,
  HrMyWorkforce,
  HrOvertimeRequest,
  HrOvertimeRequestPayload,
} from '../../types/hr-workforce';
import './workforce.css';
import './self-service.css';
import './layouts/autoservicio.css';

function initialRange(): { dateFrom: string; dateTo: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 13);
  const value = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { dateFrom: value(start), dateTo: value(end) };
}

const EMPTY_WORKFORCE: HrMyWorkforce = {
  serverTime: '',
  timezone: '',
  attendanceSummaries: [],
  incidents: [],
  corrections: [],
  overtimeRequests: [],
  leaveRequests: [],
  vacationBalances: [],
  vacationLedger: [],
};
type Panel =
  | { kind: 'correction'; summary?: HrDailyAttendanceSummary; incident?: HrAttendanceIncident }
  | { kind: 'overtime'; summary?: HrDailyAttendanceSummary }
  | { kind: 'leave' }
  | null;
type CancelPanel =
  | { kind: 'correction'; item: HrAttendanceCorrection }
  | { kind: 'overtime'; item: HrOvertimeRequest }
  | { kind: 'leave'; item: HrLeaveRequest }
  | null;
type WorkforceWorkspace = 'ATTENDANCE' | 'REQUESTS' | 'BALANCES';

export default function MyWorkforce() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab')?.toUpperCase();
  const online = useWorkforceOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const range = initialRange();
  const [dateFrom, setDateFrom] = useState(range.dateFrom);
  const [dateTo, setDateTo] = useState(range.dateTo);
  const [summaries, setSummaries] = useState<HrDailyAttendanceSummary[]>([]);
  const [workforce, setWorkforce] = useState<HrMyWorkforce>(EMPTY_WORKFORCE);
  const [leaveTypes, setLeaveTypes] = useState<HrLeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [cancelPanel, setCancelPanel] = useState<CancelPanel>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [activeWorkspace, setActiveWorkspace] = useState<WorkforceWorkspace>(requestedTab === 'OVERTIME' || requestedTab === 'LEAVE' ? 'REQUESTS' : 'ATTENDANCE');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartialWarning(null);
    try {
      const filters = { dateFrom, dateTo, limit: 100 };
      const [summaryResult, workforceResult, typesResult] = await Promise.allSettled([
        workforceClient.getMyAttendanceSummary(filters),
        workforceClient.getMyWorkforce(filters),
        workforceClient.getLeaveTypes(),
      ]);
      if (workforceResult.status === 'rejected') throw workforceResult.reason;
      setWorkforce(workforceResult.value);
      if (summaryResult.status === 'fulfilled') {
        setSummaries(summaryResult.value.items);
      } else {
        setSummaries([]);
        setPartialWarning(getWorkforceErrorMessage(summaryResult.reason, 'Los resúmenes de asistencia no están disponibles para este rango. Las solicitudes y saldos sí pueden consultarse.'));
      }
      if (typesResult.status === 'fulfilled') {
        setLeaveTypes(typesResult.value);
      } else {
        setLeaveTypes([]);
        setPartialWarning((current) => current ?? 'No fue posible cargar los tipos de permiso. Puedes consultar tu información, pero la creación de solicitudes está temporalmente deshabilitada.');
      }
    } catch (loadError) {
      setSummaries([]);
      setWorkforce(EMPTY_WORKFORCE);
      setLeaveTypes([]);
      setError(
        getWorkforceErrorMessage(loadError, 'No fue posible cargar tu información laboral.')
      );
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (requestedTab === 'OVERTIME' || requestedTab === 'LEAVE') setActiveWorkspace('REQUESTS');
  }, [requestedTab]);

  useEffect(() => {
    if (loading || activeWorkspace !== 'REQUESTS' || (requestedTab !== 'OVERTIME' && requestedTab !== 'LEAVE')) return;
    const targetId = requestedTab === 'OVERTIME' ? 'mis-horas-extra' : 'mis-permisos';
    const target = document.getElementById(targetId);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [activeWorkspace, loading, requestedTab]);

  const createCorrection = async (payload: HrAttendanceCorrectionPayload) => {
    setSaving(true);
    try {
      await workforceClient.createCorrection(payload, createWorkforceIdempotencyKey());
      showSuccess(
        'Solicitud de corrección creada. El servidor resolverá identidad, alcance y autorización.'
      );
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible solicitar la corrección.'));
    } finally {
      setSaving(false);
    }
  };

  const createOvertime = async (payload: HrOvertimeRequestPayload) => {
    setSaving(true);
    try {
      await workforceClient.createOvertimeRequest(payload, createWorkforceIdempotencyKey());
      showSuccess('Solicitud de horas extra enviada; no equivale a aprobación.');
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible solicitar horas extra.'));
    } finally {
      setSaving(false);
    }
  };

  const createLeave = async (payload: HrLeaveRequestPayload) => {
    setSaving(true);
    try {
      await workforceClient.createLeaveRequest(payload);
      showSuccess('Borrador creado. Envíalo cuando esté listo para revisión.');
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible crear la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const submitLeave = async (item: HrLeaveRequest) => {
    setSaving(true);
    try {
      await workforceClient.submitLeaveRequest(item.id);
      showSuccess('Solicitud enviada a revisión.');
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible enviar la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cancelPanel || !cancelReason.trim()) return;
    setSaving(true);
    try {
      if (cancelPanel.kind === 'correction')
        await workforceClient.cancelCorrection(
          cancelPanel.item.id,
          { reason: cancelReason.trim() },
          createWorkforceIdempotencyKey()
        );
      else if (cancelPanel.kind === 'overtime')
        await workforceClient.cancelOvertimeRequest(
          cancelPanel.item.id,
          { reason: cancelReason.trim() },
          createWorkforceIdempotencyKey()
        );
      else
        await workforceClient.cancelLeaveRequest(cancelPanel.item.id, {
          reason: cancelReason.trim(),
        });
      showSuccess('Solicitud cancelada con trazabilidad.');
      setCancelPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible cancelar la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const openCancel = (next: NonNullable<CancelPanel>) => {
    setCancelPanel(next);
    setCancelReason('');
  };

  const workflowItems = [
    ...workforce.corrections,
    ...workforce.overtimeRequests,
    ...workforce.leaveRequests,
  ];
  const pendingCount = workflowItems.filter((item) => item.status === 'DRAFT' || item.status === 'PENDING').length;
  const approvedCount = workflowItems.filter((item) => item.status === 'APPROVED' || item.status === 'APPLIED').length;
  const rejectedCount = workflowItems.filter((item) => item.status === 'REJECTED' || item.status === 'CANCELLED').length;

  const vacation = selectVacationBalance(workforce.vacationBalances);
  const ready = !loading && !error;
  const facts: HrFact[] = [
    {
      label: 'Saldo de vacaciones',
      value: ready ? (vacation ? `${formatHrNumber(vacation.available)} ${vacation.unit.toLowerCase()}` : 'Sin saldo') : '—',
      hint: vacation ? `Al ${vacation.asOf}` : 'Disponibilidad emitida por el servidor',
      tone: ready && vacation ? 'accent' : 'default',
    },
    { label: 'En espera', value: ready ? pendingCount : '—', hint: 'Borradores o pendientes', tone: ready && pendingCount > 0 ? 'warning' : 'default' },
    { label: 'Aprobadas', value: ready ? approvedCount : '—', hint: 'Aprobadas o aplicadas', tone: ready && approvedCount > 0 ? 'success' : 'default' },
    { label: 'Rechazadas o canceladas', value: ready ? rejectedCount : '—', hint: 'Contraflujos conservados en historial', tone: ready && rejectedCount > 0 ? 'danger' : 'default' },
    { label: 'Incidencias', value: ready ? workforce.incidents.length : '—', hint: 'En el rango consultado' },
  ];

  return (
    <HrPage className="hr-workforce-page my-hr-page ss-page ss-workforce">
      <MyHrNav />
      <HrHero
        eyebrow="Mi RH"
        icon={BriefcaseBusiness}
        title="Mi gestión laboral"
        subtitle="Revisa tu asistencia y gestiona solicitudes, saldos y trazabilidad en una sola bandeja"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setPanel({ kind: 'correction' })}
              disabled={!online}
            >
              <FilePenLine size={16} /> Corrección
            </Button>
            <Button variant="primary" onClick={() => setPanel({ kind: 'leave' })} disabled={!online || leaveTypes.length === 0} title={leaveTypes.length === 0 ? 'Los tipos de permiso no están disponibles' : undefined}>
              <CalendarPlus size={16} /> Permiso
            </Button>
          </>
        }
        facts={facts}
      />
      {!online && <OnlineOnlyNotice online={false} />}
      {partialWarning && (
        <div className="ss-inline-alert" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{partialWarning}</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw size={15} /> Reintentar sección
          </Button>
        </div>
      )}

      {!loading && !error && (
        <nav className="hr-ws-tabs-bar" aria-label="Bandejas de mi gestión laboral">
          <div className="hr-ws-tabs" role="tablist" aria-label="Bandejas de mi gestión laboral">
            <button type="button" role="tab" id="my-workforce-tab-attendance" aria-controls="my-workforce-panel-attendance" aria-selected={activeWorkspace === 'ATTENDANCE'} className={activeWorkspace === 'ATTENDANCE' ? 'active' : undefined} onClick={() => setActiveWorkspace('ATTENDANCE')}><Clock3 size={16} aria-hidden="true" /><span>Asistencia</span><small>{summaries.length + workforce.incidents.length}</small></button>
            <button type="button" role="tab" id="my-workforce-tab-requests" aria-controls="my-workforce-panel-requests" aria-selected={activeWorkspace === 'REQUESTS'} className={activeWorkspace === 'REQUESTS' ? 'active' : undefined} onClick={() => setActiveWorkspace('REQUESTS')}><FilePenLine size={16} aria-hidden="true" /><span>Solicitudes</span><small>{workforce.overtimeRequests.length + workforce.leaveRequests.length}</small></button>
            <button type="button" role="tab" id="my-workforce-tab-balances" aria-controls="my-workforce-panel-balances" aria-selected={activeWorkspace === 'BALANCES'} className={activeWorkspace === 'BALANCES' ? 'active' : undefined} onClick={() => setActiveWorkspace('BALANCES')}><WalletCards size={16} aria-hidden="true" /><span>Vacaciones</span><small>{workforce.vacationBalances.length}</small></button>
          </div>
        </nav>
      )}

      <HrToolbar ariaLabel="Rango de consulta">
        <label>
          Desde
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            min={dateFrom}
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <div className="hr-ws-toolbar-actions">
          {workforce.serverTime && (
            <small className="ss-meta">
              Servidor:{' '}
              {new Intl.DateTimeFormat('es-NI', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: workforce.timezone || undefined,
              }).format(new Date(workforce.serverTime))}
            </small>
          )}
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={16} /> Actualizar
          </Button>
        </div>
      </HrToolbar>

      {loading && <HrLoading text="Cargando tu gestión laboral…" />}
      {!loading && error && (
        <div className="state-placeholder" role="alert">
          <AlertTriangle size={42} />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      )}
      {!loading && !error && (
        <>
          {activeWorkspace === 'ATTENDANCE' && (
          <div id="my-workforce-panel-attendance" className="hr-ws-tabpanel" role="tabpanel" aria-labelledby="my-workforce-tab-attendance" tabIndex={0}>
          <HrSection
            id="mi-asistencia"
            className="hr-workforce-anchor"
            eyebrow="Asistencia"
            title="Mis resúmenes"
            count={summaries.length}
            description="Minutos calculados por el servidor, no por este dispositivo."
            actions={
              <Button variant="primary" size="sm" onClick={() => setPanel({ kind: 'overtime' })} disabled={!online}>
                <Plus size={15} /> Horas extra
              </Button>
            }
          >
            {summaries.length === 0 ? (
              <p className="hr-empty">Sin resúmenes en el rango.</p>
            ) : (
              <div className="hr-summary-grid">
                {summaries.map((summary) => (
                  <article key={summary.id} className="hr-summary-card">
                    <header>
                      <div>
                        <strong>{summary.date}</strong>
                        <span>{summary.branch?.name ?? 'Sin sucursal'}</span>
                      </div>
                      {summary.periodStatus && (
                        <WorkforceStatusPill status={summary.periodStatus} />
                      )}
                    </header>
                    <dl className="hr-minute-grid">
                      <div>
                        <dt>Ordinarios</dt>
                        <dd>{summary.ordinaryMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Descanso</dt>
                        <dd>{summary.breakMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Tardanza</dt>
                        <dd>{summary.lateMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Salida temprana</dt>
                        <dd>{summary.earlyDepartureMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Extra candidato</dt>
                        <dd>{summary.candidateOvertimeMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Extra aprobado</dt>
                        <dd>{summary.approvedOvertimeMinutes ?? 0} min</dd>
                      </div>
                    </dl>
                    <footer>
                      <small>Revisión fuente {summary.sourceRevision ?? '—'}</small>
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPanel({ kind: 'correction', summary })}
                          disabled={!online}
                        >
                          Corregir
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPanel({ kind: 'overtime', summary })}
                          disabled={!online}
                        >
                          Solicitar extra
                        </Button>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </HrSection>

          <div className="ss-two-col">
            <HrSection title="Mis incidencias" count={workforce.incidents.length} description="Revisa el motivo antes de pedir corrección.">
              {workforce.incidents.length === 0 ? (
                <p className="hr-empty">Sin incidencias.</p>
              ) : (
                <div className="hr-record-list">
                  {workforce.incidents.map((incident) => (
                    <article key={incident.id}>
                      <div>
                        <strong>
                          {incident.date} · {incident.type}
                        </strong>
                        <span>{incident.message}</span>
                        <small>{incident.reasonCode ?? 'Sin código adicional'}</small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={incident.status} />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPanel({ kind: 'correction', incident })}
                          disabled={!online}
                        >
                          Solicitar corrección
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </HrSection>
            <HrSection title="Mis correcciones" count={workforce.corrections.length} description="Cada cambio conserva historial y actor.">
              {workforce.corrections.length === 0 ? (
                <p className="hr-empty">Sin solicitudes.</p>
              ) : (
                <div className="hr-record-list">
                  {workforce.corrections.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.type}</strong>
                        <span>{item.reason}</span>
                        <small>{item.auditReference ?? `Solicitud #${item.id}`}</small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={item.status} />
                        {item.status === 'PENDING' && (
                          <Button size="sm" variant="ghost" onClick={() => openCancel({ kind: 'correction', item })} disabled={!online}>
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </HrSection>
          </div>
          </div>
          )}

          {activeWorkspace === 'REQUESTS' && (
          <div id="my-workforce-panel-requests" className="hr-ws-tabpanel" role="tabpanel" aria-labelledby="my-workforce-tab-requests" tabIndex={0}>
          <div className="ss-two-col">
            <section id="mis-horas-extra" className="hr-ws-section hr-workforce-anchor" tabIndex={-1} aria-labelledby="mis-horas-extra-title">
              <header className="hr-ws-section-header">
                <div>
                  <span className="hr-ws-eyebrow">Solicitudes</span>
                  <h2 id="mis-horas-extra-title">Mis horas extra<small>{workforce.overtimeRequests.length}</small></h2>
                  <p>Lo candidato y lo solicitado no sustituyen la decisión.</p>
                </div>
              </header>
              <div className="hr-ws-section-body">
              {workforce.overtimeRequests.length === 0 ? (
                <p className="hr-empty">Sin solicitudes.</p>
              ) : (
                <div className="hr-record-list">
                  {workforce.overtimeRequests.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {item.date} · {item.requestedMinutes} min
                        </strong>
                        <span>{item.reason}</span>
                        <small>Aprobado por servidor: {item.approvedMinutes ?? 0} min</small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={item.status} />
                        {(item.status === 'DRAFT' || item.status === 'PENDING') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openCancel({ kind: 'overtime', item })}
                            disabled={!online}
                          >
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              </div>
            </section>
            <section id="mis-permisos" className="hr-ws-section hr-workforce-anchor" tabIndex={-1} aria-labelledby="mis-permisos-title">
              <header className="hr-ws-section-header">
                <div>
                  <span className="hr-ws-eyebrow">Solicitudes</span>
                  <h2 id="mis-permisos-title">Mis permisos y vacaciones<small>{workforce.leaveRequests.length}</small></h2>
                  <p>Rango, fracción y estado autoritativo.</p>
                </div>
              </header>
              <div className="hr-ws-section-body">
              {workforce.leaveRequests.length === 0 ? (
                <p className="hr-empty">Sin solicitudes.</p>
              ) : (
                <div className="hr-record-list">
                  {workforce.leaveRequests.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.leaveType?.name ?? `Tipo #${item.leaveTypeId}`}</strong>
                        <span>
                          {item.startDate} – {item.endDate} · {item.fraction}
                        </span>
                        <small>{item.reason}</small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={item.status} />
                        {item.status === 'DRAFT' && (
                          <Button variant="primary"
                            size="sm"
                            onClick={() => void submitLeave(item)}
                            disabled={!online || saving}
                          >
                            Enviar
                          </Button>
                        )}
                        {(item.status === 'DRAFT' || item.status === 'PENDING') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openCancel({ kind: 'leave', item })}
                            disabled={!online}
                          >
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              </div>
            </section>
          </div>
          </div>
          )}

          {activeWorkspace === 'BALANCES' && (
          <div id="my-workforce-panel-balances" className="hr-ws-tabpanel" role="tabpanel" aria-labelledby="my-workforce-tab-balances" tabIndex={0}>
          <div className="ss-two-col">
            <HrSection id="mis-vacaciones" className="hr-workforce-anchor" eyebrow="Vacaciones" title="Mis saldos" count={workforce.vacationBalances.length} description="Disponibilidad emitida por el servidor.">
              {workforce.vacationBalances.length === 0 ? (
                <p className="hr-empty">Sin saldos.</p>
              ) : (
                <div className="hr-balance-grid">
                  {workforce.vacationBalances.map((balance) => (
                    <article key={balance.id}>
                      <strong>
                        {balance.leaveType?.name ?? balance.periodLabel ?? `Saldo #${balance.id}`}
                      </strong>
                      <span>
                        {formatHrNumber(balance.available)} {balance.unit} disponibles
                      </span>
                      <small>
                        Devengado {formatHrNumber(balance.accrued)} · usado {formatHrNumber(balance.used)} · pendiente{' '}
                        {formatHrNumber(balance.pending)}
                      </small>
                      <small>
                        Al {balance.asOf} · revisión {balance.sourceRevision ?? '—'}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </HrSection>
            <HrSection title="Mi ledger" count={workforce.vacationLedger.length} description="Movimientos y resultado reportado.">
              {workforce.vacationLedger.length === 0 ? (
                <p className="hr-empty">Sin movimientos.</p>
              ) : (
                <div className="hr-record-list">
                  {workforce.vacationLedger.map((entry) => (
                    <article key={entry.id}>
                      <div>
                        <strong>
                          {entry.type} · {formatHrNumber(entry.amount)} {entry.unit}
                        </strong>
                        <span>{entry.reason}</span>
                        <small>
                          {entry.effectiveDate} · {entry.reference ?? `#${entry.id}`}
                        </small>
                      </div>
                      {entry.resultingBalance != null && (
                        <strong>
                          {entry.resultingBalance} {entry.unit}
                        </strong>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </HrSection>
          </div>
          </div>
          )}
        </>
      )}

      <FullScreenModal
        isOpen={Boolean(panel)}
        onClose={() => !saving && setPanel(null)}
        title={
          panel?.kind === 'correction'
            ? 'Solicitar corrección'
            : panel?.kind === 'overtime'
              ? 'Solicitar horas extra'
              : 'Solicitar permiso o vacaciones'
        }
      >
          {panel?.kind === 'correction' && (
            <AttendanceCorrectionForm
              dailySummaryId={panel.summary?.id ?? panel.incident?.dailySummaryId ?? undefined}
              incidentId={panel.incident?.id}
              timezone={panel.summary?.timezone ?? workforce.timezone}
              online={online}
              saving={saving}
              notice={!online ? <OnlineOnlyNotice online={false} compact /> : undefined}
              onSubmit={createCorrection}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel?.kind === 'overtime' && (
            <OvertimeRequestForm
              initialDate={panel.summary?.date ?? dateTo}
              dailySummaryId={panel.summary?.id}
              candidateMinutes={panel.summary?.candidateOvertimeMinutes}
              online={online}
              saving={saving}
              notice={!online ? <OnlineOnlyNotice online={false} compact /> : undefined}
              onSubmit={createOvertime}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel?.kind === 'leave' && (
            <LeaveRequestForm
              leaveTypes={leaveTypes}
              online={online}
              saving={saving}
              notice={!online ? <OnlineOnlyNotice online={false} compact /> : undefined}
              onSubmit={createLeave}
              onCancel={() => setPanel(null)}
            />
          )}
      </FullScreenModal>

      <FullScreenModal
        isOpen={Boolean(cancelPanel)}
        onClose={() => !saving && setCancelPanel(null)}
        title="Cancelar solicitud"
      >
        <HrModalFormShell
          ariaLabel="Cancelación de solicitud"
          tabLabel="Confirmación"
          sectionTitle="Motivo de cancelación"
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          formClassName="hr-workforce-form"
          notice={!online ? <OnlineOnlyNotice online={false} compact /> : undefined}
          onSubmit={(event) => void cancel(event)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setCancelPanel(null)}>
                Volver
              </Button>
              <Button type="submit" variant="danger" disabled={!online || saving || !cancelReason.trim()}>
                {saving ? 'Cancelando…' : 'Confirmar cancelación'}
              </Button>
            </>
          }
        >
          <label className="span-full">
            Razón de cancelación
            <textarea
              rows={5}
              maxLength={700}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              required
            />
          </label>
        </HrModalFormShell>
      </FullScreenModal>
    </HrPage>
  );
}
