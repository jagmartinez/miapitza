import { useCallback, useEffect, useState } from 'react';
import { formatHrNumber } from '../../utils/hrFormat';
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
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import MyHrNav from '../../components/hr/MyHrNav';
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
import { useAppToast } from '../../context/ToastContext';
import type {
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
  | { kind: 'overtime'; item: HrOvertimeRequest }
  | { kind: 'leave'; item: HrLeaveRequest }
  | null;

export default function MyWorkforce() {
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
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [cancelPanel, setCancelPanel] = useState<CancelPanel>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { dateFrom, dateTo, limit: 100 };
      const [summaryResult, workforceResult, typesResult] = await Promise.all([
        workforceClient.getMyAttendanceSummary(filters),
        workforceClient.getMyWorkforce(filters),
        workforceClient.getLeaveTypes(),
      ]);
      setSummaries(summaryResult.items);
      setWorkforce(workforceResult);
      setLeaveTypes(typesResult);
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
      if (cancelPanel.kind === 'overtime')
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
  const rejectedCount = workflowItems.filter((item) => item.status === 'REJECTED').length;

  return (
    <div className="page-wrapper hr-workforce-page">
      <PageHeader
        title="Mi gestión laboral"
        subtitle="Asistencia, solicitudes, vacaciones y trazabilidad"
        icon={BriefcaseBusiness}
        actions={
          <div className="hr-header-actions">
            <Button
              variant="secondary"
              onClick={() => setPanel({ kind: 'correction' })}
              disabled={!online}
            >
              <FilePenLine size={16} /> Corrección
            </Button>
            <Button onClick={() => setPanel({ kind: 'leave' })} disabled={!online}>
              <CalendarPlus size={16} /> Permiso
            </Button>
          </div>
        }
      />
      <MyHrNav />
      <OnlineOnlyNotice online={online} />
      <section className="hr-workforce-filters">
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
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw size={16} /> Actualizar
        </Button>
        {workforce.serverTime && (
          <small>
            Servidor:{' '}
            {new Intl.DateTimeFormat('es-NI', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: workforce.timezone || undefined,
            }).format(new Date(workforce.serverTime))}
          </small>
        )}
      </section>

      {loading && <LoadingSpinner text="Cargando tu gestión laboral…" />}
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
          <nav className="hr-workforce-jump-nav" aria-label="Contenido de mi gestión laboral">
            <a href="#mi-asistencia"><Clock3 size={17} /> Asistencia</a>
            <a href="#mis-solicitudes"><FilePenLine size={17} /> Solicitudes</a>
            <a href="#mis-vacaciones"><WalletCards size={17} /> Vacaciones</a>
          </nav>
          <section className="hr-workflow-overview" aria-label="Estado de mis solicitudes">
            <div><span>En espera</span><strong>{pendingCount}</strong><small>Borradores o pendientes</small></div>
            <div><span>Aprobadas</span><strong>{approvedCount}</strong><small>Aprobadas o aplicadas</small></div>
            <div><span>Denegadas</span><strong>{rejectedCount}</strong><small>Solicitudes rechazadas</small></div>
          </section>
          <section id="mi-asistencia" className="hr-workforce-section hr-workforce-anchor">
            <div className="hr-section-heading">
              <div>
                <h2>
                  <Clock3 size={20} /> Mis resúmenes
                </h2>
                <p>Minutos calculados por el servidor, no por este dispositivo.</p>
              </div>
              <Button size="sm" onClick={() => setPanel({ kind: 'overtime' })} disabled={!online}>
                <Plus size={15} /> Horas extra
              </Button>
            </div>
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
          </section>

          <div className="hr-workforce-columns">
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>Mis incidencias</h2>
                  <p>Revisa el motivo antes de pedir corrección.</p>
                </div>
              </div>
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
            </section>
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>Mis correcciones</h2>
                  <p>Cada cambio conserva historial y actor.</p>
                </div>
              </div>
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
                      <WorkforceStatusPill status={item.status} />
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="hr-workforce-columns">
            <section id="mis-solicitudes" className="hr-workforce-section hr-workforce-anchor">
              <div className="hr-section-heading">
                <div>
                  <h2>Mis horas extra</h2>
                  <p>Lo candidato y lo solicitado no sustituyen la decisión.</p>
                </div>
              </div>
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
            </section>
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>Mis permisos y vacaciones</h2>
                  <p>Rango, fracción y estado autoritativo.</p>
                </div>
              </div>
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
                          <Button
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
            </section>
          </div>

          <div className="hr-workforce-columns">
            <section id="mis-vacaciones" className="hr-workforce-section hr-workforce-anchor">
              <div className="hr-section-heading">
                <div>
                  <h2>
                    <WalletCards size={20} /> Mis saldos
                  </h2>
                  <p>Disponibilidad emitida por el servidor.</p>
                </div>
              </div>
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
            </section>
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>Mi ledger</h2>
                  <p>Movimientos y resultado reportado.</p>
                </div>
              </div>
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
            </section>
          </div>
        </>
      )}

      <Sidebar
        isOpen={Boolean(panel)}
        onClose={() => !saving && setPanel(null)}
        title={
          panel?.kind === 'correction'
            ? 'Solicitar corrección'
            : panel?.kind === 'overtime'
              ? 'Solicitar horas extra'
              : 'Solicitar permiso o vacaciones'
        }
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <div className="hr-sidebar-body">
          <OnlineOnlyNotice online={online} compact />
          {panel?.kind === 'correction' && (
            <AttendanceCorrectionForm
              dailySummaryId={panel.summary?.id ?? panel.incident?.dailySummaryId ?? undefined}
              incidentId={panel.incident?.id}
              timezone={panel.summary?.timezone ?? workforce.timezone}
              online={online}
              saving={saving}
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
              onSubmit={createOvertime}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel?.kind === 'leave' && (
            <LeaveRequestForm
              leaveTypes={leaveTypes}
              online={online}
              saving={saving}
              onSubmit={createLeave}
              onCancel={() => setPanel(null)}
            />
          )}
        </div>
      </Sidebar>

      <Sidebar
        isOpen={Boolean(cancelPanel)}
        onClose={() => !saving && setCancelPanel(null)}
        title="Cancelar solicitud"
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <form
          className="hr-workforce-form hr-sidebar-body"
          onSubmit={(event) => void cancel(event)}
        >
          <OnlineOnlyNotice online={online} compact />
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
          <div className="hr-form-actions span-full">
            <Button type="button" variant="ghost" onClick={() => setCancelPanel(null)}>
              Volver
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!online || saving || !cancelReason.trim()}
            >
              {saving ? 'Cancelando…' : 'Confirmar cancelación'}
            </Button>
          </div>
        </form>
      </Sidebar>
    </div>
  );
}
