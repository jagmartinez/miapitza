import HrReactSelect from '../../components/hr/HrReactSelect';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList as FilePenLine,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import AttendanceCorrectionForm from '../../components/hr/AttendanceCorrectionForm';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import OvertimeRequestForm from '../../components/hr/OvertimeRequestForm';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import WorkforceStatusPill from '../../components/hr/WorkforceStatusPill';
import { hrClient } from '../../components/hr/hrClient';
import {
  createWorkforceIdempotencyKey,
  getWorkforceErrorMessage,
  workforceClient,
} from '../../components/hr/workforceClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrOrganizationCatalogs } from '../../types/hr';
import type {
  HrAttendanceCorrection,
  HrAttendanceCorrectionPayload,
  HrAttendanceIncident,
  HrAttendancePeriod,
  HrDailyAttendanceSummary,
  HrDecision,
  HrOvertimeRequest,
  HrOvertimeRequestPayload,
} from '../../types/hr-workforce';
import './workforce.css';

const EMPTY_LOOKUPS: HrOrganizationCatalogs = {
  departments: [],
  positions: [],
  costCenters: [],
  branches: [],
  users: [],
};

function today(): string {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function displayDateTime(value?: string | null): string {
  return value
    ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value)
      )
    : '—';
}

type CreatePanel =
  | { kind: 'correction'; summary?: HrDailyAttendanceSummary; incident?: HrAttendanceIncident }
  | { kind: 'overtime'; summary?: HrDailyAttendanceSummary }
  | { kind: 'period' }
  | null;
type DecisionPanel =
  | { kind: 'correction'; item: HrAttendanceCorrection }
  | { kind: 'overtime'; item: HrOvertimeRequest }
  | { kind: 'close' | 'reopen'; item: HrAttendancePeriod }
  | null;

export default function AttendanceManagement() {
  const online = useWorkforceOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [date, setDate] = useState(today());
  const [branchId, setBranchId] = useState('');
  const [userId, setUserId] = useState('');
  const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
  const [summaries, setSummaries] = useState<HrDailyAttendanceSummary[]>([]);
  const [incidents, setIncidents] = useState<HrAttendanceIncident[]>([]);
  const [corrections, setCorrections] = useState<HrAttendanceCorrection[]>([]);
  const [overtime, setOvertime] = useState<HrOvertimeRequest[]>([]);
  const [periods, setPeriods] = useState<HrAttendancePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createPanel, setCreatePanel] = useState<CreatePanel>(null);
  const [decisionPanel, setDecisionPanel] = useState<DecisionPanel>(null);
  const [decision, setDecision] = useState<HrDecision>('APPROVED');
  const [reason, setReason] = useState('');
  const [approvedMinutes, setApprovedMinutes] = useState('');
  const [periodForm, setPeriodForm] = useState({ dateFrom: date, dateTo: date, reason: '' });

  const filters = useMemo(
    () => ({
      date,
      branchId: branchId ? Number(branchId) : undefined,
      userId: userId ? Number(userId) : undefined,
      limit: 100,
    }),
    [branchId, date, userId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        organization,
        summaryResult,
        incidentResult,
        correctionResult,
        overtimeResult,
        periodResult,
      ] = await Promise.all([
        hrClient.getOrganization(),
        workforceClient.getDailySummaries(filters),
        workforceClient.getIncidents(filters),
        workforceClient.getCorrections(filters),
        workforceClient.getOvertimeRequests(filters),
        workforceClient.getPeriods({ dateFrom: date, dateTo: date, limit: 50 }),
      ]);
      setLookups(organization);
      setSummaries(summaryResult.items);
      setIncidents(incidentResult.items);
      setCorrections(correctionResult.items);
      setOvertime(overtimeResult.items);
      setPeriods(periodResult.items);
    } catch (loadError) {
      setSummaries([]);
      setIncidents([]);
      setCorrections([]);
      setOvertime([]);
      setPeriods([]);
      setError(getWorkforceErrorMessage(loadError, 'No fue posible cargar el control diario.'));
    } finally {
      setLoading(false);
    }
  }, [date, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCorrection = async (payload: HrAttendanceCorrectionPayload) => {
    setSaving(true);
    try {
      await workforceClient.createCorrection(payload, createWorkforceIdempotencyKey());
      showSuccess('Corrección compensatoria registrada para decisión y auditoría.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible crear la corrección.'));
    } finally {
      setSaving(false);
    }
  };

  const createOvertime = async (payload: HrOvertimeRequestPayload) => {
    setSaving(true);
    try {
      await workforceClient.createOvertimeRequest(payload, createWorkforceIdempotencyKey());
      showSuccess('Solicitud de horas extra registrada.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible crear la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const createPeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await workforceClient.createPeriod(
        { ...periodForm, reason: periodForm.reason.trim() },
        createWorkforceIdempotencyKey()
      );
      showSuccess('Periodo de asistencia creado.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible crear el periodo.'));
    } finally {
      setSaving(false);
    }
  };

  const openDecision = (panel: NonNullable<DecisionPanel>) => {
    setDecisionPanel(panel);
    setDecision('APPROVED');
    setReason('');
    setApprovedMinutes(panel.kind === 'overtime' ? String(panel.item.requestedMinutes) : '');
  };

  const submitDecision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!decisionPanel || !reason.trim()) return;
    setSaving(true);
    try {
      const key = createWorkforceIdempotencyKey();
      if (decisionPanel.kind === 'correction') {
        await workforceClient.decideCorrection(
          decisionPanel.item.id,
          { decision, reason: reason.trim() },
          key
        );
      } else if (decisionPanel.kind === 'overtime') {
        await workforceClient.decideOvertimeRequest(
          decisionPanel.item.id,
          {
            decision,
            reason: reason.trim(),
            ...(decision === 'APPROVED' ? { approvedMinutes: Number(approvedMinutes) } : {}),
          },
          key
        );
      } else if (decisionPanel.kind === 'close') {
        await workforceClient.closePeriod(decisionPanel.item.id, { reason: reason.trim() }, key);
      } else {
        await workforceClient.reopenPeriod(decisionPanel.item.id, { reason: reason.trim() }, key);
      }
      showSuccess('Decisión registrada con trazabilidad.');
      setDecisionPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible registrar la decisión.'));
    } finally {
      setSaving(false);
    }
  };

  const users = (lookups.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );
  const branches = lookups.branches ?? [];

  return (
    <div className="page-wrapper hr-workforce-page">
      <PageHeader
        title="Control diario de asistencia"
        subtitle="Minutos autoritativos, incidencias, correcciones, extras y periodos"
        icon={CalendarClock}
        actions={
          <Button
            onClick={() => {
              setPeriodForm({ dateFrom: date, dateTo: date, reason: '' });
              setCreatePanel({ kind: 'period' });
            }}
            disabled={!online}
          >
            <Plus size={17} /> Crear periodo
          </Button>
        }
      />
      <OnlineOnlyNotice online={online} />

      <section className="hr-workforce-filters" aria-label="Filtros del resumen diario">
        <label>
          Fecha
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Sucursal
          <HrReactSelect value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </HrReactSelect>
        </label>
        <label>
          Usuario
          <HrReactSelect value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Todos</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </HrReactSelect>
        </label>
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </section>

      {loading && <LoadingSpinner text="Cargando control diario…" />}
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
          <section className="hr-workforce-section" aria-labelledby="daily-summary-title">
            <div className="hr-section-heading">
              <div>
                <h2 id="daily-summary-title">Resumen diario</h2>
                <p>Todos los minutos provienen del cálculo versionado del servidor.</p>
              </div>
            </div>
            {summaries.length === 0 ? (
              <p className="hr-empty">Sin resúmenes para el alcance seleccionado.</p>
            ) : (
              <div className="hr-summary-grid">
                {summaries.map((summary) => (
                  <article key={summary.id} className="hr-summary-card">
                    <header>
                      <div>
                        <strong>{summary.user?.name ?? `Usuario #${summary.userId}`}</strong>
                        <span>
                          {summary.branch?.name ?? 'Sin sucursal'} · {summary.date}
                        </span>
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
                      <small>
                        Revisión fuente: {summary.sourceRevision ?? '—'} · calculado{' '}
                        {displayDateTime(summary.calculatedAt)}
                      </small>
                      <div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCreatePanel({ kind: 'correction', summary })}
                          disabled={!online}
                        >
                          <FilePenLine size={15} /> Corregir
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCreatePanel({ kind: 'overtime', summary })}
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
                  <h2>Incidencias</h2>
                  <p>Señales generadas por las reglas del servidor.</p>
                </div>
              </div>
              {incidents.length === 0 ? (
                <p className="hr-empty">Sin incidencias.</p>
              ) : (
                <div className="hr-record-list">
                  {incidents.map((incident) => (
                    <article key={incident.id}>
                      <div>
                        <strong>{incident.user?.name ?? `Usuario #${incident.userId}`}</strong>
                        <span>{incident.message}</span>
                        <small>
                          {incident.date} · {incident.reasonCode ?? incident.type}
                        </small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={incident.severity} />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCreatePanel({ kind: 'correction', incident })}
                          disabled={!online}
                        >
                          Corregir
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
                  <h2>Correcciones</h2>
                  <p>Solicitudes compensatorias; nunca se borra el historial original.</p>
                </div>
              </div>
              {corrections.length === 0 ? (
                <p className="hr-empty">Sin correcciones.</p>
              ) : (
                <div className="hr-record-list">
                  {corrections.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {item.user?.name ?? `Usuario #${item.userId}`} · {item.type}
                        </strong>
                        <span>{item.reason}</span>
                        <small>
                          {displayDateTime(item.createdAt)}{' '}
                          {item.auditReference ? `· ${item.auditReference}` : ''}
                        </small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={item.status} />
                        {item.status === 'PENDING' && (
                          <Button
                            size="sm"
                            onClick={() => openDecision({ kind: 'correction', item })}
                            disabled={!online}
                          >
                            Decidir
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
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>Horas extra</h2>
                  <p>Candidato no significa aprobado.</p>
                </div>
              </div>
              {overtime.length === 0 ? (
                <p className="hr-empty">Sin solicitudes.</p>
              ) : (
                <div className="hr-record-list">
                  {overtime.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {item.user?.name ?? `Usuario #${item.userId}`} · {item.date}
                        </strong>
                        <span>
                          {item.requestedMinutes} min solicitados · {item.approvedMinutes ?? 0} min
                          aprobados
                        </span>
                        <small>{item.reason}</small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={item.status} />
                        {item.status === 'PENDING' && (
                          <Button
                            size="sm"
                            onClick={() => openDecision({ kind: 'overtime', item })}
                            disabled={!online}
                          >
                            Decidir
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
                  <h2>Periodos</h2>
                  <p>Cierre y reapertura impactan conciliación y pueden afectar nómina.</p>
                </div>
              </div>
              {periods.length === 0 ? (
                <p className="hr-empty">Sin periodos.</p>
              ) : (
                <div className="hr-record-list">
                  {periods.map((period) => (
                    <article key={period.id}>
                      <div>
                        <strong>
                          {period.dateFrom} – {period.dateTo}
                        </strong>
                        <span>
                          {period.summaryCount ?? 0} resúmenes ·{' '}
                          {period.unresolvedIncidentCount ?? 0} incidencias abiertas
                        </span>
                        <small>
                          {period.payrollReference
                            ? `Nómina: ${period.payrollReference}`
                            : 'Sin referencia de nómina'}
                        </small>
                      </div>
                      <div className="hr-record-actions">
                        <WorkforceStatusPill status={period.status} />
                        {period.status === 'CLOSED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openDecision({ kind: 'reopen', item: period })}
                            disabled={!online}
                          >
                            <RotateCcw size={15} /> Reabrir
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => openDecision({ kind: 'close', item: period })}
                            disabled={!online}
                          >
                            <LockKeyhole size={15} /> Cerrar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <Sidebar
        isOpen={Boolean(createPanel)}
        onClose={() => !saving && setCreatePanel(null)}
        title={
          createPanel?.kind === 'correction'
            ? 'Corrección compensatoria'
            : createPanel?.kind === 'overtime'
              ? 'Solicitud de horas extra'
              : 'Nuevo periodo'
        }
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <div className="hr-sidebar-body">
          <OnlineOnlyNotice online={online} compact />
          {createPanel?.kind === 'correction' && (
            <AttendanceCorrectionForm
              users={users}
              branches={branches}
              initialUserId={createPanel.summary?.userId ?? createPanel.incident?.userId}
              dailySummaryId={
                createPanel.summary?.id ?? createPanel.incident?.dailySummaryId ?? undefined
              }
              incidentId={createPanel.incident?.id}
              timezone={createPanel.summary?.timezone}
              online={online}
              saving={saving}
              onSubmit={createCorrection}
              onCancel={() => setCreatePanel(null)}
            />
          )}
          {createPanel?.kind === 'overtime' && (
            <OvertimeRequestForm
              users={users}
              initialUserId={createPanel.summary?.userId}
              initialDate={createPanel.summary?.date ?? date}
              dailySummaryId={createPanel.summary?.id}
              candidateMinutes={createPanel.summary?.candidateOvertimeMinutes}
              online={online}
              saving={saving}
              onSubmit={createOvertime}
              onCancel={() => setCreatePanel(null)}
            />
          )}
          {createPanel?.kind === 'period' && (
            <form className="hr-workforce-form" onSubmit={(event) => void createPeriod(event)}>
              <label>
                Desde
                <input
                  type="date"
                  value={periodForm.dateFrom}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  min={periodForm.dateFrom}
                  value={periodForm.dateTo}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, dateTo: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="span-full">
                Razón de apertura
                <textarea
                  rows={4}
                  value={periodForm.reason}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </label>
              <div className="hr-form-actions span-full">
                <Button type="button" variant="ghost" onClick={() => setCreatePanel(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!online || saving}>
                  {saving ? 'Creando…' : 'Crear periodo'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Sidebar>

      <Sidebar
        isOpen={Boolean(decisionPanel)}
        onClose={() => !saving && setDecisionPanel(null)}
        title={
          decisionPanel?.kind === 'close'
            ? 'Cerrar periodo'
            : decisionPanel?.kind === 'reopen'
              ? 'Reabrir periodo'
              : 'Registrar decisión'
        }
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <form
          className="hr-workforce-form hr-sidebar-body"
          onSubmit={(event) => void submitDecision(event)}
        >
          <OnlineOnlyNotice online={online} compact />
          {decisionPanel?.kind === 'close' || decisionPanel?.kind === 'reopen' ? (
            <div className="hr-sensitive-warning span-full" role="alert">
              <AlertTriangle size={20} />
              <span>
                {decisionPanel.kind === 'close'
                  ? 'Cerrar congela los resúmenes del periodo para conciliación. Verifica incidencias, extras y correcciones pendientes; podría afectar una nómina.'
                  : 'Reabrir invalida la condición de cierre anterior y puede requerir recalcular o conciliar una nómina ya preparada.'}
              </span>
            </div>
          ) : (
            <label>
              Decisión
              <HrReactSelect
                value={decision}
                onChange={(event) => setDecision(event.target.value as HrDecision)}
              >
                <option value="APPROVED">Aprobar</option>
                <option value="REJECTED">Rechazar</option>
              </HrReactSelect>
            </label>
          )}
          {decisionPanel?.kind === 'overtime' && decision === 'APPROVED' && (
            <label>
              Minutos aprobados por el servidor
              <input
                type="number"
                min="0"
                step="1"
                value={approvedMinutes}
                onChange={(event) => setApprovedMinutes(event.target.value)}
                required
              />
            </label>
          )}
          <label className="span-full">
            Razón obligatoria
            <textarea
              rows={5}
              maxLength={700}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
          <div className="hr-form-actions span-full">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDecisionPanel(null)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={decisionPanel?.kind === 'close' ? 'danger' : 'primary'}
              disabled={!online || saving || !reason.trim()}
            >
              {saving ? 'Registrando…' : 'Confirmar con auditoría'}
            </Button>
          </div>
        </form>
      </Sidebar>
    </div>
  );
}
