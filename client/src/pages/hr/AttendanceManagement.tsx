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
import CatalogTable, { type CatalogColumn } from '../../components/CatalogTable';
import Sidebar from '../../components/Sidebar';
import AttendanceCorrectionForm from '../../components/hr/AttendanceCorrectionForm';
import { collectAllPages } from '../../components/hr/collectAllPages';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import { HrHero, HrPage, HrPanelState, HrTablePanel, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
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
import './attendance.css';
import './admin-tables.css';
import './hr-admin-operations.css';
import '../Inventory.css';
import './layouts/asistencia.css';

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
        collectAllPages((page) => workforceClient.getPeriods({
          dateFrom: date,
          dateTo: date,
          branchId: filters.branchId,
          userId: filters.userId,
          page,
          limit: 100,
        })),
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

  const openIncidents = incidents.filter((item) => item.status === 'OPEN').length;
  const pendingCorrections = corrections.filter((item) => item.status === 'PENDING').length;
  const pendingOvertime = overtime.filter((item) => item.status === 'PENDING').length;
  const lateDays = summaries.filter((item) => item.lateMinutes > 0 || item.earlyDepartureMinutes > 0).length;
  const closedPeriods = periods.filter((item) => item.status === 'CLOSED').length;
  const managementFacts: HrFact[] = loading || error ? [] : [
    { label: 'Jornadas del día', value: summaries.length, hint: dateLabel(date), tone: 'accent' },
    { label: 'Tardanzas o salidas antes', value: lateDays, hint: 'Según cálculo del servidor', tone: lateDays > 0 ? 'warning' : 'success' },
    { label: 'Incidencias abiertas', value: openIncidents, tone: openIncidents > 0 ? 'danger' : 'success' },
    { label: 'Decisiones pendientes', value: pendingCorrections + pendingOvertime, hint: `${pendingCorrections} correcciones · ${pendingOvertime} horas extra`, tone: pendingCorrections + pendingOvertime > 0 ? 'warning' : 'default' },
    { label: 'Periodos cerrados', value: `${closedPeriods} / ${periods.length}` },
  ];
  const openPeriodPanel = () => {
    setPeriodForm({ dateFrom: date, dateTo: date, reason: '' });
    setCreatePanel({ kind: 'period' });
  };
  const tablePagination = {
    page: tablePage,
    totalPages: Math.max(1, Math.ceil(activeTableCount / PAGE_SIZE)),
    totalItems: activeTableCount,
    pageSize: PAGE_SIZE,
    onPageChange: setTablePage,
  };
  const summaryColumns: CatalogColumn<HrDailyAttendanceSummary>[] = [
    { key: 'user', header: 'Empleado', render: (summary) => <><strong>{summary.user?.name ?? `Usuario #${summary.userId}`}</strong><small>{summary.incidentCount ? `${summary.incidentCount} incidencia(s)` : 'Sin incidencias'}</small></> },
    { key: 'branch', header: 'Sucursal', render: (summary) => summary.branch?.name ?? 'Sin sucursal' },
    { key: 'scheduled', header: 'Programado', render: (summary) => <>{summary.scheduledMinutes ?? 0} min</> },
    { key: 'worked', header: 'Trabajado', render: (summary) => <>{summary.ordinaryMinutes} min</> },
    { key: 'break', header: 'Descanso', render: (summary) => <>{summary.breakMinutes} min</> },
    { key: 'late', header: 'Tardanza', render: (summary) => <span className={summary.lateMinutes > 0 ? 'hr-admin-cell-warning' : undefined}>{summary.lateMinutes} min</span> },
    { key: 'early', header: 'Salida antes', render: (summary) => <span className={summary.earlyDepartureMinutes > 0 ? 'hr-admin-cell-warning' : undefined}>{summary.earlyDepartureMinutes} min</span> },
    { key: 'overtime', header: 'Extra', render: (summary) => <>{summary.approvedOvertimeMinutes ?? 0} / {summary.candidateOvertimeMinutes} min</> },
    { key: 'status', header: 'Estado', render: (summary) => (summary.periodStatus ? <WorkforceStatusPill status={summary.periodStatus} /> : 'Sin periodo') },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (summary) => <div className="hr-admin-row-actions table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', summary })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${summary.user?.name ?? summary.userId}`}><Pencil size={16} /></Button><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'overtime', summary })} disabled={!online} title="Registrar horas extra" aria-label={`Registrar horas extra de ${summary.user?.name ?? summary.userId}`}><Clock3 size={16} /></Button></div>,
    },
  ];
  const incidentColumns: CatalogColumn<HrAttendanceIncident>[] = [
    { key: 'user', header: 'Empleado', render: (incident) => <strong>{incident.user?.name ?? `Usuario #${incident.userId}`}</strong> },
    { key: 'date', header: 'Fecha', render: (incident) => dateLabel(incident.date) },
    { key: 'message', header: 'Motivo', render: (incident) => <><strong>{incident.message}</strong><small>{incident.reasonCode ?? incident.type}</small></> },
    { key: 'severity', header: 'Gravedad', render: (incident) => <WorkforceStatusPill status={incident.severity} /> },
    { key: 'status', header: 'Estado', render: (incident) => <WorkforceStatusPill status={incident.status} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (incident) => <div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', incident })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${incident.user?.name ?? incident.userId}`}><Pencil size={16} /></Button></div>,
    },
  ];
  const correctionColumns: CatalogColumn<HrAttendanceCorrection>[] = [
    { key: 'user', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
    { key: 'createdAt', header: 'Solicitada', render: (item) => displayDateTime(item.createdAt) },
    { key: 'type', header: 'Tipo', render: (item) => item.type },
    { key: 'reason', header: 'Motivo', render: (item) => item.reason },
    { key: 'status', header: 'Estado', render: (item) => <WorkforceStatusPill status={item.status} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (item) => (item.status === 'PENDING' ? <div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'correction', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar corrección de ${item.user?.name ?? item.userId}`}><Eye size={16} /></Button></div> : <span className="hr-admin-muted">Finalizada</span>),
    },
  ];
  const overtimeColumns: CatalogColumn<HrOvertimeRequest>[] = [
    { key: 'user', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
    { key: 'date', header: 'Fecha', render: (item) => dateLabel(item.date) },
    { key: 'requested', header: 'Solicitado', render: (item) => <>{item.requestedMinutes} min</> },
    { key: 'approved', header: 'Aprobado', render: (item) => item.approvedMinutes ?? '—' },
    { key: 'reason', header: 'Motivo', render: (item) => item.reason },
    { key: 'status', header: 'Estado', render: (item) => <WorkforceStatusPill status={item.status} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (item) => (item.status === 'PENDING' ? <div className="table-actions"><Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'overtime', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar horas extra de ${item.user?.name ?? item.userId}`}><Eye size={16} /></Button></div> : <span className="hr-admin-muted">Finalizada</span>),
    },
  ];
  const periodColumns: CatalogColumn<HrAttendancePeriod>[] = [
    { key: 'range', header: 'Periodo', render: (period) => <strong>{dateLabel(period.dateFrom)} – {dateLabel(period.dateTo)}</strong> },
    { key: 'employees', header: 'Empleados', render: (period) => period.summaryCount ?? 0 },
    { key: 'incidents', header: 'Incidencias', render: (period) => <span className={(period.unresolvedIncidentCount ?? 0) > 0 ? 'hr-admin-cell-warning' : undefined}>{period.unresolvedIncidentCount ?? 0}</span> },
    { key: 'corrections', header: 'Correcciones', render: (period) => <span className={(period.pendingCorrectionCount ?? 0) > 0 ? 'hr-admin-cell-warning' : undefined}>{period.pendingCorrectionCount ?? 0}</span> },
    { key: 'overtime', header: 'Horas extra', render: (period) => <span className={(period.pendingOvertimeCount ?? 0) > 0 ? 'hr-admin-cell-warning' : undefined}>{period.pendingOvertimeCount ?? 0}</span> },
    { key: 'payroll', header: 'Nómina', render: (period) => period.payrollReference ?? 'No vinculada' },
    { key: 'status', header: 'Estado', render: (period) => <WorkforceStatusPill status={period.status} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (period) => {
        const blockers = (period.unresolvedIncidentCount ?? 0) + (period.pendingCorrectionCount ?? 0) + (period.pendingOvertimeCount ?? 0);
        return <div className="table-actions">{period.status === 'CLOSED' ? <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'reopen', item: period })} disabled={!online} title="Reabrir periodo" aria-label={`Reabrir periodo ${period.id}`}><RotateCcw size={16} /></Button> : <Button className="table-action-btn danger" size="sm" variant="ghost" onClick={() => openDecision({ kind: 'close', item: period })} disabled={!online || blockers > 0} title={blockers > 0 ? `Resuelve ${blockers} pendiente(s) antes de cerrar` : 'Cerrar periodo'} aria-label={`Cerrar periodo ${period.id}`}><LockKeyhole size={16} /></Button>}</div>;
      },
    },
  ];

  return (
    <HrPage className="inventory-page hr-workforce-page hr-attendance-management-page hr-admin-catalog-page hr-operation-page hr-asis-page hr-asis-management">
      <div className="hr-asis-hero inventory-header-new">
        <HrHero
          eyebrow="Recursos humanos"
          icon={CalendarClock}
          title="Control diario de asistencia"
          subtitle="Revisa quién trabajó, resuelve incidencias y aprueba horas extra antes de cerrar el periodo"
          actions={
            <Button onClick={openPeriodPanel} disabled={!online}>
              <Plus size={17} /> Crear periodo
            </Button>
          }
          facts={managementFacts}
        />
      </div>
      <OnlineOnlyNotice online={online} />

      {!loading && !error && <nav className="hr-ws-tabs-bar hr-asis-tabs-bar" aria-label="Bandejas de asistencia">
        <div className="hr-ws-tabs filters-toolbar hr-admin-tab-toolbar" role="tablist" aria-label="Bandejas de asistencia">
          {([
            ['DAY', 'Jornadas', summaries.length],
            ['INCIDENTS', 'Incidencias', openIncidents],
            ['CORRECTIONS', 'Correcciones', pendingCorrections],
            ['OVERTIME', 'Horas extra', pendingOvertime],
            ['PERIODS', 'Periodos', periods.length],
          ] as Array<[AttendanceTable, string, number]>).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`attendance-tab-${value.toLowerCase()}`}
              aria-controls={`attendance-panel-${value.toLowerCase()}`}
              aria-selected={activeTable === value}
              className={activeTable === value ? 'active' : undefined}
              onClick={() => setActiveTable(value)}
            >
              {label} <small>{count}</small>
            </button>
          ))}
        </div>
      </nav>}

      <HrToolbar ariaLabel="Filtros del resumen diario" className="hr-operation-toolbar hr-asis-toolbar">
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
        <label className="is-wide">
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
        <div className="hr-ws-toolbar-actions">
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={16} /> Actualizar
          </Button>
        </div>
      </HrToolbar>


      <HrTablePanel
        id={`attendance-panel-${activeTable.toLowerCase()}`}
        role="tabpanel"
        aria-labelledby={`attendance-tab-${activeTable.toLowerCase()}`}
        className="hr-asis-table-panel"
      >
        {loading && <HrPanelState><LoadingSpinner text="Cargando control diario…" /></HrPanelState>}
        {!loading && error && (
          <HrPanelState role="alert">
            <AlertTriangle size={42} />
            <p className="state-error">{error}</p>
            <Button variant="ghost" onClick={() => void load()}>
              Reintentar
            </Button>
          </HrPanelState>
        )}
        {!loading && !error && activeTable === 'DAY' && (
          <CatalogTable<HrDailyAttendanceSummary>
            className="hr-asis-management-table"
            ariaLabel={`Jornadas del ${dateLabel(date)}`}
            rows={pageSlice(summaries)}
            rowKey={(summary) => summary.id}
            columns={summaryColumns}
            pagination={tablePagination}
            emptyLabel="Sin registros"
            emptyState={<div className="hr-admin-empty"><strong>No hay jornadas para este filtro</strong><span>Cambia la fecha, sucursal o empleado y actualiza la consulta.</span><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw size={15} /> Actualizar</Button></div>}
          />
        )}
        {!loading && !error && activeTable === 'INCIDENTS' && (
          <CatalogTable<HrAttendanceIncident>
            className="hr-asis-management-table"
            ariaLabel="Incidencias que requieren revisión"
            rows={pageSlice(incidents)}
            rowKey={(incident) => incident.id}
            columns={incidentColumns}
            pagination={tablePagination}
            emptyLabel="Sin registros"
            emptyState={<div className="hr-admin-empty"><strong>No hay incidencias</strong><span>Las jornadas del filtro actual están al día.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div>}
          />
        )}
        {!loading && !error && activeTable === 'CORRECTIONS' && (
          <CatalogTable<HrAttendanceCorrection>
            className="hr-asis-management-table"
            ariaLabel="Solicitudes de corrección"
            rows={pageSlice(corrections)}
            rowKey={(item) => item.id}
            columns={correctionColumns}
            pagination={tablePagination}
            emptyLabel="Sin registros"
            emptyState={<div className="hr-admin-empty"><strong>No hay correcciones</strong><span>Cuando alguien solicite un ajuste aparecerá aquí.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div>}
          />
        )}
        {!loading && !error && activeTable === 'OVERTIME' && (
          <CatalogTable<HrOvertimeRequest>
            className="hr-asis-management-table"
            ariaLabel="Solicitudes de horas extra"
            rows={pageSlice(overtime)}
            rowKey={(item) => item.id}
            columns={overtimeColumns}
            pagination={tablePagination}
            emptyLabel="Sin registros"
            emptyState={<div className="hr-admin-empty"><strong>No hay solicitudes de horas extra</strong><span>Puedes registrar una desde la jornada de un empleado.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button></div>}
          />
        )}
        {!loading && !error && activeTable === 'PERIODS' && (
          <>
            {(branchId || userId) && (
              <div className="hr-attendance-alert info" role="status">
                Los periodos de asistencia son de toda la empresa. Los contadores pendientes respetan el filtro de sucursal/empleado seleccionado arriba.
              </div>
            )}
            <CatalogTable<HrAttendancePeriod>
              className="hr-asis-management-table"
              ariaLabel="Periodos de asistencia"
              rows={pageSlice(periods)}
              rowKey={(period) => period.id}
              columns={periodColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay periodos</strong><span>Crea un periodo para preparar y cerrar la asistencia que alimentará la nómina.</span><Button size="sm" onClick={() => { setPeriodForm({ dateFrom: date, dateTo: date, reason: '' }); setCreatePanel({ kind: 'period' }); }} disabled={!online}><Plus size={15} /> Crear periodo</Button></div>}
            />
          </>
        )}
      </HrTablePanel>
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
              Minutos a aprobar
              <input
                type="number"
                min="0"
                max={decisionPanel.item.requestedMinutes}
                step="1"
                value={approvedMinutes}
                onChange={(event) => setApprovedMinutes(event.target.value)}
                required
              />
              <small>
                Solicitados: {decisionPanel.item.requestedMinutes} min. El servidor valida el tope final contra la jornada.
              </small>
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
    </HrPage>
  );
}
