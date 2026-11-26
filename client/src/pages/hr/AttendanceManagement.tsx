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
import {
  AppSelect, Button, DataTable, DateInput, EmptyState, FullScreenModal, Input, LoadErrorState, PageContent, PageHeader, TableToolbar, Tabs,
  Textarea,
} from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
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
import form from '../../components/hr/hrForm.module.css';

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
    <PageContent>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Jornadas']}
        title="Control diario de asistencia"
        description="Revisa quién trabajó, resuelve incidencias y aprueba horas extra antes de cerrar el periodo"
        actions={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setPeriodForm({ dateFrom: date, dateTo: date, reason: '' });
              setCreatePanel({ kind: 'period' });
            }}
            disabled={!online}
          >
            Crear periodo
          </Button>
        }
      />
      <OnlineOnlyNotice online={online} />

      {!loading && !error && (
        <Tabs
          ariaLabel="Bandejas de asistencia"
          active={activeTable}
          onChange={(id) => setActiveTable(id as AttendanceTable)}
          tabs={([
            ['DAY', 'Jornadas', summaries.length],
            ['INCIDENTS', 'Incidencias', incidents.filter((item) => item.status === 'OPEN').length],
            ['CORRECTIONS', 'Correcciones', corrections.filter((item) => item.status === 'PENDING').length],
            ['OVERTIME', 'Horas extra', overtime.filter((item) => item.status === 'PENDING').length],
            ['PERIODS', 'Periodos', periods.length],
          ] as Array<[AttendanceTable, string, number]>).map(([id, label, badge]) => ({ id, label, badge }))}
        />
      )}

      <TableToolbar actions={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()}>Actualizar</Button>}>
        <DateInput aria-label="Fecha" title="Fecha" value={date} onChange={(event) => setDate(event.target.value)} />
        <AppSelect<string>
          aria-label="Sucursal"
          options={[
            { value: '', label: 'Todas las sucursales' },
            ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
          ]}
          value={branchId}
          onChange={(next) => setBranchId(next ?? '')}
          isClearable={false}
        />
        <AppSelect<string>
          aria-label="Empleado"
          options={[
            { value: '', label: 'Todos los empleados' },
            ...users.map((user) => ({ value: String(user.id), label: user.name })),
          ]}
          value={userId}
          onChange={(next) => setUserId(next ?? '')}
          isClearable={false}
        />
      </TableToolbar>

      {loading && <HrLoading text="Cargando control diario…" />}
      {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && (
        <div className={form.stack} role="tabpanel" id={`attendance-panel-${activeTable.toLowerCase()}`} aria-label="Administración diaria de asistencia">
            {activeTable === 'DAY' && (
              <DataTable
                ariaLabel={`Jornadas del ${dateLabel(date)}`}
                rows={summaries}
                rowKey={(summary) => summary.id}
                pagination={{ mode: 'client' }}
                minWidth="80rem"
                empty={<EmptyState title="No hay jornadas para este filtro" description="Cambia la fecha, sucursal o empleado y actualiza la consulta." action={<Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw size={15} /> Actualizar</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (summary) => <span className={form.cellStack}><span className={form.cellTitle}>{summary.user?.name ?? `Usuario #${summary.userId}`}</span><span className={form.cellSub}>{summary.incidentCount ? `${summary.incidentCount} incidencia(s)` : 'Sin incidencias'}</span></span> },
                  { key: 'c1', header: 'Sucursal', render: (summary) => <>{summary.branch?.name ?? 'Sin sucursal'}</> },
                  { key: 'c2', header: 'Programado', render: (summary) => <>{summary.scheduledMinutes ?? 0} min</> },
                  { key: 'c3', header: 'Trabajado', render: (summary) => <>{summary.ordinaryMinutes} min</> },
                  { key: 'c4', header: 'Descanso', render: (summary) => <>{summary.breakMinutes} min</> },
                  { key: 'c5', header: 'Tardanza', render: (summary) => <span className={summary.lateMinutes > 0 ? form.cellWarning : undefined}>{summary.lateMinutes} min</span> },
                  { key: 'c6', header: 'Salida antes', render: (summary) => <span className={summary.earlyDepartureMinutes > 0 ? form.cellWarning : undefined}>{summary.earlyDepartureMinutes} min</span> },
                  { key: 'c7', header: 'Extra', render: (summary) => <>{summary.approvedOvertimeMinutes ?? 0} / {summary.candidateOvertimeMinutes} min</> },
                  { key: 'c8', header: 'Estado', render: (summary) => <>{summary.periodStatus ? <WorkforceStatusPill status={summary.periodStatus} /> : 'Sin periodo'}</> },
                  { key: 'c9', header: 'Acciones', width: '6rem', type: 'actions', render: (summary) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', summary })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${summary.user?.name ?? summary.userId}`} icon={Pencil} /><Button size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'overtime', summary })} disabled={!online} title="Registrar horas extra" aria-label={`Registrar horas extra de ${summary.user?.name ?? summary.userId}`} icon={Clock3} /></div> },
                ]}
              />
            )}

            {activeTable === 'INCIDENTS' && (
              <DataTable
                ariaLabel="Incidencias que requieren revisión"
                rows={incidents}
                rowKey={(incident) => incident.id}
                pagination={{ mode: 'client' }}
                minWidth="48rem"
                empty={<EmptyState title="No hay incidencias" description="Las jornadas del filtro actual están al día." action={<Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (incident) => <strong>{incident.user?.name ?? `Usuario #${incident.userId}`}</strong> },
                  { key: 'c1', header: 'Fecha', render: (incident) => <>{dateLabel(incident.date)}</> },
                  { key: 'c2', header: 'Motivo', render: (incident) => <span className={form.cellStack}><span className={form.cellTitle}>{incident.message}</span><span className={form.cellSub}>{incident.reasonCode ?? incident.type}</span></span> },
                  { key: 'c3', header: 'Gravedad', render: (incident) => <><WorkforceStatusPill status={incident.severity} /></> },
                  { key: 'c4', header: 'Estado', render: (incident) => <><WorkforceStatusPill status={incident.status} /></> },
                  { key: 'c5', header: 'Acción', width: '6rem', type: 'actions', render: (incident) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'correction', incident })} disabled={!online} title="Corregir marcaje" aria-label={`Corregir marcaje de ${incident.user?.name ?? incident.userId}`} icon={Pencil} /></div> },
                ]}
              />
            )}

            {activeTable === 'CORRECTIONS' && (
              <DataTable
                ariaLabel="Solicitudes de corrección"
                rows={corrections}
                rowKey={(item) => item.id}
                pagination={{ mode: 'client' }}
                minWidth="48rem"
                empty={<EmptyState title="No hay correcciones" description="Cuando alguien solicite un ajuste aparecerá aquí." action={<Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
                  { key: 'c1', header: 'Solicitada', render: (item) => <>{displayDateTime(item.createdAt)}</> },
                  { key: 'c2', header: 'Tipo', render: (item) => <>{item.type}</> },
                  { key: 'c3', header: 'Motivo', render: (item) => <>{item.reason}</> },
                  { key: 'c4', header: 'Estado', render: (item) => <><WorkforceStatusPill status={item.status} /></> },
                  { key: 'c5', header: 'Acción', width: '6rem', type: 'actions', render: (item) => <>{item.status === 'PENDING' ? <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => openDecision({ kind: 'correction', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar corrección de ${item.user?.name ?? item.userId}`} icon={Eye} /></div> : <span className={form.cellSub}>Finalizada</span>}</> },
                ]}
              />
            )}

            {activeTable === 'OVERTIME' && (
              <DataTable
                ariaLabel="Solicitudes de horas extra"
                rows={overtime}
                rowKey={(item) => item.id}
                pagination={{ mode: 'client' }}
                minWidth="56rem"
                empty={<EmptyState title="No hay solicitudes de horas extra" description="Puedes registrar una desde la jornada de un empleado." action={<Button size="sm" variant="ghost" onClick={() => setActiveTable('DAY')}>Ver jornadas</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
                  { key: 'c1', header: 'Fecha', render: (item) => <>{dateLabel(item.date)}</> },
                  { key: 'c2', header: 'Solicitado', render: (item) => <>{item.requestedMinutes} min</> },
                  { key: 'c3', header: 'Aprobado', render: (item) => <>{item.approvedMinutes ?? '—'}</> },
                  { key: 'c4', header: 'Motivo', render: (item) => <>{item.reason}</> },
                  { key: 'c5', header: 'Estado', render: (item) => <><WorkforceStatusPill status={item.status} /></> },
                  { key: 'c6', header: 'Acción', width: '6rem', type: 'actions', render: (item) => <>{item.status === 'PENDING' ? <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => openDecision({ kind: 'overtime', item })} disabled={!online} title="Revisar y decidir" aria-label={`Revisar horas extra de ${item.user?.name ?? item.userId}`} icon={Eye} /></div> : <span className={form.cellSub}>Finalizada</span>}</> },
                ]}
              />
            )}

            {activeTable === 'PERIODS' && (
              <>
              {(branchId || userId) && (
                <div className={form.alertInfo} role="status">
                  Los periodos de asistencia son de toda la empresa. Los contadores pendientes respetan el filtro de sucursal/empleado seleccionado arriba.
                </div>
              )}
              <DataTable
                ariaLabel="Periodos de asistencia"
                rows={periods}
                rowKey={(period) => period.id}
                pagination={{ mode: 'client' }}
                minWidth="64rem"
                empty={<EmptyState title="No hay periodos" description="Crea un periodo para preparar y cerrar la asistencia que alimentará la nómina." action={<Button variant="primary" size="sm" onClick={() => { setPeriodForm({ dateFrom: date, dateTo: date, reason: '' }); setCreatePanel({ kind: 'period' }); }} disabled={!online}><Plus size={15} /> Crear periodo</Button>} />}
                columns={[
                  { key: 'c0', header: 'Periodo', render: (period) => <strong>{dateLabel(period.dateFrom)} – {dateLabel(period.dateTo)}</strong> },
                  { key: 'c1', header: 'Empleados', render: (period) => <>{period.summaryCount ?? 0}</> },
                  { key: 'c2', header: 'Incidencias', render: (period) => <span className={(period.unresolvedIncidentCount ?? 0) > 0 ? form.cellWarning : undefined}>{period.unresolvedIncidentCount ?? 0}</span> },
                  { key: 'c3', header: 'Correcciones', render: (period) => <span className={(period.pendingCorrectionCount ?? 0) > 0 ? form.cellWarning : undefined}>{period.pendingCorrectionCount ?? 0}</span> },
                  { key: 'c4', header: 'Horas extra', render: (period) => <span className={(period.pendingOvertimeCount ?? 0) > 0 ? form.cellWarning : undefined}>{period.pendingOvertimeCount ?? 0}</span> },
                  { key: 'c5', header: 'Nómina', render: (period) => <>{period.payrollReference ?? 'No vinculada'}</> },
                  { key: 'c6', header: 'Estado', render: (period) => <><WorkforceStatusPill status={period.status} /></> },
                  { key: 'c7', header: 'Acción', width: '6rem', type: 'actions', render: (period) => { const blockers = (period.unresolvedIncidentCount ?? 0) + (period.pendingCorrectionCount ?? 0) + (period.pendingOvertimeCount ?? 0); return <div className={form.rowActions}>{period.status === 'CLOSED' ? <Button size="sm" variant="ghost" onClick={() => openDecision({ kind: 'reopen', item: period })} disabled={!online} title="Reabrir periodo" aria-label={`Reabrir periodo ${period.id}`} icon={RotateCcw} /> : <Button size="sm" variant="ghost" onClick={() => openDecision({ kind: 'close', item: period })} disabled={!online || blockers > 0} title={blockers > 0 ? `Resuelve ${blockers} pendiente(s) antes de cerrar` : 'Cerrar periodo'} aria-label={`Cerrar periodo ${period.id}`} icon={LockKeyhole} />}</div>; } },
                ]}
              />
              </>
            )}
        </div>
      )}
      <FullScreenModal
        isOpen={Boolean(createPanel)}
        onClose={() => !saving && setCreatePanel(null)}
        breadcrumb={['Recursos humanos', 'Jornadas']}
        title={
          createPanel?.kind === 'correction'
            ? 'Corrección compensatoria'
            : createPanel?.kind === 'overtime'
              ? 'Solicitud de horas extra'
              : 'Nuevo periodo'
        }
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
                <Button variant="primary" type="submit" disabled={!online || saving}>
                  {saving ? 'Creando…' : 'Crear periodo'}
                </Button>
              </>
            }
          >
            <label>
              Desde
              <DateInput
               
                value={periodForm.dateFrom}
                onChange={(event) =>
                  setPeriodForm((current) => ({ ...current, dateFrom: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Hasta
              <DateInput
               
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
              <Textarea
                rows={4}
                value={periodForm.reason}
                onChange={(event) =>
                  setPeriodForm((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </label>
          </HrModalFormShell>
        )}
      </FullScreenModal>

      <FullScreenModal
        isOpen={Boolean(decisionPanel)}
        onClose={() => !saving && setDecisionPanel(null)}
        title={
          decisionPanel?.kind === 'close'
            ? 'Cerrar periodo'
            : decisionPanel?.kind === 'reopen'
              ? 'Reabrir periodo'
              : 'Registrar decisión'
        }
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
            <div className={`${form.alertWarning} span-full`} role="alert">
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
              <AppSelect<string>
                options={[
                  { value: 'APPROVED', label: 'Aprobar' },
                  { value: 'REJECTED', label: 'Rechazar' },
                ]}
                value={decision}
                onChange={(next) => setDecision((next ?? '') as HrDecision)}
                isClearable={false}
              />
            </label>
          )}
          {decisionPanel?.kind === 'overtime' && decision === 'APPROVED' && (
            <label>
              Minutos a aprobar
              <Input
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
            <Textarea
              rows={5}
              maxLength={700}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
        </HrModalFormShell>
      </FullScreenModal>
    </PageContent>
  );
}
