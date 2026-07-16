import HrReactSelect from '../../components/hr/HrReactSelect';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  LockKeyhole,
  Clock3,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import Sidebar from '../../components/Sidebar';
import AttendanceCorrectionForm from '../../components/hr/AttendanceCorrectionForm';
import { collectAllPages } from '../../components/hr/collectAllPages';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
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
import './admin-tables.css';
import './hr-admin-operations.css';
import '../Inventory.css';

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

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(parsed);
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

type AttendanceTable = 'DAY' | 'INCIDENTS' | 'CORRECTIONS' | 'OVERTIME' | 'PERIODS';
const PAGE_SIZE = 12;

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
  const [activeTable, setActiveTable] = useState<AttendanceTable>('DAY');
  const [tablePage, setTablePage] = useState(1);

  const filters = useMemo(
    () => ({
      date,
      branchId: branchId ? Number(branchId) : undefined,
      userId: userId ? Number(userId) : undefined,
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
        collectAllPages((page) => workforceClient.getDailySummaries({ ...filters, page, limit: 100 })),
        collectAllPages((page) => workforceClient.getIncidents({ ...filters, page, limit: 100 })),
        collectAllPages((page) => workforceClient.getCorrections({ ...filters, page, limit: 100 })),
        collectAllPages((page) => workforceClient.getOvertimeRequests({ ...filters, page, limit: 100 })),
        collectAllPages((page) => workforceClient.getPeriods({ dateFrom: date, dateTo: date, page, limit: 100 })),
      ]);
      setLookups(organization);
      setSummaries(summaryResult);
      setIncidents(incidentResult);
      setCorrections(correctionResult);
      setOvertime(overtimeResult);
      setPeriods(periodResult);
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

  useEffect(() => { setTablePage(1); }, [activeTable, branchId, date, userId]);

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
  const activeTableCount = activeTable === 'DAY' ? summaries.length
    : activeTable === 'INCIDENTS' ? incidents.length
      : activeTable === 'CORRECTIONS' ? corrections.length
        : activeTable === 'OVERTIME' ? overtime.length
          : periods.length;
  const pageSlice = <T,>(items: T[]) => items.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);
  useEffect(() => { setTablePage((page) => Math.min(page, Math.max(1, Math.ceil(activeTableCount / PAGE_SIZE)))); }, [activeTableCount]);

  return (
    <div className="page-wrapper inventory-page hr-workforce-page hr-attendance-management-page hr-admin-catalog-page hr-operation-page">
      <PageHeader
        className="inventory-header-new hr-operation-header"
        title="Control diario de asistencia"
        subtitle="Revisa quién trabajó, resuelve incidencias y aprueba horas extra antes de cerrar el periodo"
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

      <section className="hr-workforce-filters inventory-filters-row hr-operation-toolbar" aria-label="Filtros del resumen diario">
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
          Empleado
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

      {!loading && !error && <div className="filters-toolbar hr-admin-tab-toolbar" role="tablist" aria-label="Bandejas de asistencia">
        {([
          ['DAY', 'Jornadas', summaries.length],
          ['INCIDENTS', 'Incidencias', incidents.filter((item) => item.status === 'OPEN').length],
          ['CORRECTIONS', 'Correcciones', corrections.filter((item) => item.status === 'PENDING').length],
          ['OVERTIME', 'Horas extra', overtime.filter((item) => item.status === 'PENDING').length],
          ['PERIODS', 'Periodos', periods.length],
        ] as Array<[AttendanceTable, string, number]>).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`attendance-tab-${value.toLowerCase()}`}
            aria-controls={`attendance-panel-${value.toLowerCase()}`}
            aria-selected={activeTable === value}
            onClick={() => setActiveTable(value)}
          >
            {label} <span>{count}</span>
          </button>
        ))}
      </div>}

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
        <section className="pr-table-card" aria-label="Administración diaria de asistencia">
          <div
            className="hr-admin-table-wrap"
            role="tabpanel"
            id={`attendance-panel-${activeTable.toLowerCase()}`}
            aria-labelledby={`attendance-tab-${activeTable.toLowerCase()}`}
            tabIndex={0}
          >
            {activeTable === 'DAY' && (
              <table className="hr-admin-table inventory-table" aria-label={`Jornadas del ${dateLabel(date)}`}>
                <thead><tr><th scope="col">Empleado</th><th scope="col">Sucursal</th><th scope="col">Programado</th><th scope="col">Trabajado</th><th scope="col">Descanso</th><th scope="col">Tardanza</th><th scope="col">Salida antes</th><th scope="col">Extra</th><th scope="col">Estado</th><th scope="col" className="hr-admin-actions-col">Acciones</th></tr></thead>
                <tbody>
                  {summaries.length === 0 ? (
                    <tr><td colSpan={10}><div className="hr-admin-empty"><strong>No hay jornadas para este filtro</strong><span>Cambia la fecha, sucursal o empleado y actualiza la consulta.</span><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw size={15} /> Actualizar</Button></div></td></tr>
                  ) : pageSlice(summaries).map((summary) => (
                    <tr key={summary.id}>
                      <td><strong>{summary.user?.name ?? `Usuario #${summary.userId}`}</strong><small>{summary.incidentCount ? `${summary.incidentCount} incidencia(s)` : 'Sin incidencias'}</small></td>
                      <td>{summary.branch?.name ?? 'Sin sucursal'}</td>
                      <td>{summary.scheduledMinutes ?? 0} min</td>
                      <td>{summary.ordinaryMinutes} min</td>
                      <td>{summary.breakMinutes} min</td>
                      <td className={summary.lateMinutes > 0 ? 'hr-admin-cell-warning' : ''}>{summary.lateMinutes} min</td>
                      <td className={summary.earlyDepartureMinutes > 0 ? 'hr-admin-cell-warning' : ''}>{summary.earlyDepartureMinutes} min</td>
                      <td>{summary.approvedOvertimeMinutes ?? 0} / {summary.candidateOvertimeMinutes} min</td>
                      <td>{summary.periodStatus ? <WorkforceStatusPill status={summary.periodStatus} /> : 'Sin periodo'}</td>
                      <td className="hr-admin-actions-col"><div className="hr-admin-row-actions table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', summary })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${summary.user?.name ?? summary.userId}`}><Pencil size={16} /></Button><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'overtime', summary })} disabled={!online} title="Registrar horas extra" aria-label={`Registrar horas extra de ${summary.user?.name ?? summary.userId}`}><Clock3 size={16} /></Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTable === 'INCIDENTS' && (
              <table className="hr-admin-table inventory-table" aria-label="Incidencias que requieren revisión">
                <thead><tr><th scope="col">Empleado</th><th scope="col">Fecha</th><th scope="col">Motivo</th><th scope="col">Gravedad</th><th scope="col">Estado</th><th scope="col" className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{incidents.length === 0 ? <tr><td colSpan={6}><div className="hr-admin-empty"><strong>No hay incidencias</strong><span>Las jornadas del filtro actual están al día.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div></td></tr> : pageSlice(incidents).map((incident) => <tr key={incident.id}><td><strong>{incident.user?.name ?? `Usuario #${incident.userId}`}</strong></td><td>{dateLabel(incident.date)}</td><td><strong>{incident.message}</strong><small>{incident.reasonCode ?? incident.type}</small></td><td><WorkforceStatusPill status={incident.severity} /></td><td><WorkforceStatusPill status={incident.status} /></td><td className="hr-admin-actions-col"><div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', incident })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${incident.user?.name ?? incident.userId}`}><Pencil size={16} /></Button></div></td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'CORRECTIONS' && (
              <table className="hr-admin-table inventory-table" aria-label="Solicitudes de corrección">
                <thead><tr><th scope="col">Empleado</th><th scope="col">Solicitada</th><th scope="col">Tipo</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col" className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{corrections.length === 0 ? <tr><td colSpan={6}><div className="hr-admin-empty"><strong>No hay correcciones</strong><span>Cuando alguien solicite un ajuste aparecerá aquí.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div></td></tr> : pageSlice(corrections).map((item) => <tr key={item.id}><td><strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong></td><td>{displayDateTime(item.createdAt)}</td><td>{item.type}</td><td>{item.reason}</td><td><WorkforceStatusPill status={item.status} /></td><td className="hr-admin-actions-col">{item.status === 'PENDING' ? <div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'correction', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar corrección de ${item.user?.name ?? item.userId}`}><Eye size={16} /></Button></div> : <span className="hr-admin-muted">Finalizada</span>}</td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'OVERTIME' && (
              <table className="hr-admin-table inventory-table" aria-label="Solicitudes de horas extra">
                <thead><tr><th scope="col">Empleado</th><th scope="col">Fecha</th><th scope="col">Solicitado</th><th scope="col">Aprobado</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col" className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{overtime.length === 0 ? <tr><td colSpan={7}><div className="hr-admin-empty"><strong>No hay solicitudes de horas extra</strong><span>Puedes registrar una desde la jornada de un empleado.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div></td></tr> : pageSlice(overtime).map((item) => <tr key={item.id}><td><strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong></td><td>{dateLabel(item.date)}</td><td>{item.requestedMinutes} min</td><td>{item.approvedMinutes ?? '—'}</td><td>{item.reason}</td><td><WorkforceStatusPill status={item.status} /></td><td className="hr-admin-actions-col">{item.status === 'PENDING' ? <div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'overtime', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar horas extra de ${item.user?.name ?? item.userId}`}><Eye size={16} /></Button></div> : <span className="hr-admin-muted">Finalizada</span>}</td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'PERIODS' && (
              <table className="hr-admin-table inventory-table" aria-label="Periodos de asistencia">
                <thead><tr><th scope="col">Periodo</th><th scope="col">Empleados</th><th scope="col">Incidencias</th><th scope="col">Correcciones</th><th scope="col">Horas extra</th><th scope="col">Nómina</th><th scope="col">Estado</th><th scope="col" className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{periods.length === 0 ? <tr><td colSpan={8}><div className="hr-admin-empty"><strong>No hay periodos</strong><span>Crea un periodo para preparar y cerrar la asistencia que alimentará la nómina.</span><Button size="sm" onClick={() => { setPeriodForm({ dateFrom: date, dateTo: date, reason: '' }); setCreatePanel({ kind: 'period' }); }} disabled={!online}><Plus size={15} /> Crear periodo</Button></div></td></tr> : pageSlice(periods).map((period) => {
                  const blockers = (period.unresolvedIncidentCount ?? 0) + (period.pendingCorrectionCount ?? 0) + (period.pendingOvertimeCount ?? 0);
                  return <tr key={period.id}><td><strong>{dateLabel(period.dateFrom)} – {dateLabel(period.dateTo)}</strong></td><td>{period.summaryCount ?? 0}</td><td className={(period.unresolvedIncidentCount ?? 0) > 0 ? 'hr-admin-cell-warning' : ''}>{period.unresolvedIncidentCount ?? 0}</td><td className={(period.pendingCorrectionCount ?? 0) > 0 ? 'hr-admin-cell-warning' : ''}>{period.pendingCorrectionCount ?? 0}</td><td className={(period.pendingOvertimeCount ?? 0) > 0 ? 'hr-admin-cell-warning' : ''}>{period.pendingOvertimeCount ?? 0}</td><td>{period.payrollReference ?? 'No vinculada'}</td><td><WorkforceStatusPill status={period.status} /></td><td className="hr-admin-actions-col"><div className="table-actions">{period.status === 'CLOSED' ? <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'reopen', item: period })} disabled={!online} title="Reabrir periodo" aria-label={`Reabrir periodo ${period.id}`}><RotateCcw size={16} /></Button> : <Button className="table-action-btn danger" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'close', item: period })} disabled={!online || blockers > 0} title={blockers > 0 ? `Resuelve ${blockers} pendiente(s) antes de cerrar` : 'Cerrar periodo'} aria-label={`Cerrar periodo ${period.id}`}><LockKeyhole size={16} /></Button>}</div></td></tr>;
                })}</tbody>
              </table>
            )}
          </div>
          <Pagination page={tablePage} totalPages={Math.max(1, Math.ceil(activeTableCount / PAGE_SIZE))} totalItems={activeTableCount} pageSize={PAGE_SIZE} onPageChange={setTablePage} alwaysShow emptyLabel="Sin registros" />
        </section>
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
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        {createPanel?.kind !== 'period' && (
          <>
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
                notice={<OnlineOnlyNotice online={online} compact />}
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
                notice={<OnlineOnlyNotice online={online} compact />}
                onSubmit={createOvertime}
                onCancel={() => setCreatePanel(null)}
              />
            )}
          </>
        )}
        {createPanel?.kind === 'period' && (
          <HrModalFormShell
            ariaLabel="Sección de periodo de asistencia"
            tabLabel="Periodo"
            sectionTitle="Rango y motivo de apertura"
            icon={<CalendarClock size={18} aria-hidden="true" />}
            formClassName="hr-workforce-form"
            notice={<OnlineOnlyNotice online={online} compact />}
            onSubmit={(event) => void createPeriod(event)}
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setCreatePanel(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!online || saving}>
                  {saving ? 'Creando…' : 'Crear periodo'}
                </Button>
              </>
            }
          >
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
          </HrModalFormShell>
        )}
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
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <HrModalFormShell
          ariaLabel="Sección de decisión de asistencia"
          tabLabel={decisionPanel?.kind === 'close' ? 'Cierre' : decisionPanel?.kind === 'reopen' ? 'Reapertura' : 'Decisión'}
          sectionTitle="Resolución y justificación"
          icon={decisionPanel?.kind === 'close' ? <LockKeyhole size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          formClassName="hr-workforce-form"
          notice={<OnlineOnlyNotice online={online} compact />}
          onSubmit={(event) => void submitDecision(event)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setDecisionPanel(null)} disabled={saving}>Cancelar</Button>
              <Button type="submit" variant={decisionPanel?.kind === 'close' ? 'danger' : 'primary'} disabled={!online || saving || !reason.trim()}>{saving ? 'Registrando…' : 'Confirmar con auditoría'}</Button>
            </>
          }
        >
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
        </HrModalFormShell>
      </Sidebar>
    </div>
  );
}
