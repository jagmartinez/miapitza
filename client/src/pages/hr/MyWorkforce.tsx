import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatHrNumber } from '../../utils/hrDisplay';
import {
  AlertTriangle,
  CalendarPlus,
  Clock3,
  ClipboardList as FilePenLine,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  Button, DataTable, DateInput, EmptyState, FormSection, FullScreenModal, IconButton, LoadErrorState, PageContent, PageHeader, StatCard, TableToolbar, Tabs,
  Textarea,
} from '@/ui';
import form from '../../components/hr/hrForm.module.css';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
import HrModalFormShell, { HrModalFooterSlot } from '../../components/hr/HrModalFormShell';
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
  const serverTimeLabel = workforce.serverTime
    ? new Intl.DateTimeFormat('es-NI', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: workforce.timezone || undefined,
    }).format(new Date(workforce.serverTime))
    : null;

  const recordItem = (key: string | number, title: ReactNode, line: ReactNode, meta: ReactNode, actions: ReactNode) => (
    <li key={key}>
      <span className={form.cellStack}>
        <span className={form.cellTitle}>{title}</span>
        <span>{line}</span>
        <span className={form.cellSub}>{meta}</span>
      </span>
      <span className={form.actions}>{actions}</span>
    </li>
  );

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Mi RH']}
        title="Mi gestión laboral"
        description="Revisa tu asistencia y gestiona solicitudes, saldos y trazabilidad en una sola bandeja"
        actions={(
          <>
            <Button icon={FilePenLine} onClick={() => setPanel({ kind: 'correction' })} disabled={!online}>Corrección</Button>
            <Button variant="primary" icon={CalendarPlus} onClick={() => setPanel({ kind: 'leave' })} disabled={!online || leaveTypes.length === 0} title={leaveTypes.length === 0 ? 'Los tipos de permiso no están disponibles' : undefined}>Permiso</Button>
            <MyHrNav />
          </>
        )}
      />
      {!online && <OnlineOnlyNotice online={false} />}
      {partialWarning && (
        <div className={`${form.alertWarning} ${form.actions}`} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{partialWarning}</span>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void load()}>Reintentar sección</Button>
        </div>
      )}

      {ready && (
        <section className={form.kpis} aria-label="Resumen de mi gestión laboral">
          <StatCard
            tone={vacation ? 'primary' : 'neutral'}
            label="Saldo de vacaciones"
            value={vacation ? `${formatHrNumber(vacation.available)} ${vacation.unit.toLowerCase()}` : 'Sin saldo'}
            context={vacation ? `Al ${vacation.asOf}` : 'Disponibilidad emitida por el servidor'}
          />
          <StatCard
            tone={pendingCount > 0 ? 'warning' : 'neutral'}
            label="En espera"
            value={String(pendingCount)}
            context={`Borradores o pendientes · Aprobadas ${approvedCount} · Rechazadas o canceladas ${rejectedCount}`}
            action={pendingCount > 0 ? { label: 'Ver solicitudes', onClick: () => setActiveWorkspace('REQUESTS') } : undefined}
          />
          {workforce.incidents.length > 0 && (
            <StatCard
              tone="danger"
              label="Incidencias"
              value={String(workforce.incidents.length)}
              context="En el rango consultado; revisa el motivo antes de pedir corrección."
              action={{ label: 'Ver asistencia', onClick: () => setActiveWorkspace('ATTENDANCE') }}
            />
          )}
        </section>
      )}

      {ready && (
        <Tabs
          ariaLabel="Bandejas de mi gestión laboral"
          active={activeWorkspace}
          onChange={(id) => setActiveWorkspace(id as WorkforceWorkspace)}
          tabs={[
            { id: 'ATTENDANCE', label: 'Asistencia', badge: summaries.length + workforce.incidents.length },
            { id: 'REQUESTS', label: 'Solicitudes', badge: workforce.overtimeRequests.length + workforce.leaveRequests.length },
            { id: 'BALANCES', label: 'Vacaciones', badge: workforce.vacationBalances.length },
          ]}
        />
      )}

      <TableToolbar
        actions={(
          <>
            {serverTimeLabel && <span className={form.cellSub}>Servidor: {serverTimeLabel}</span>}
            <Button variant="ghost" icon={RefreshCw} onClick={() => void load()}>Actualizar</Button>
          </>
        )}
      >
        <DateInput aria-label="Desde" title="Desde" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <DateInput aria-label="Hasta" title="Hasta" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
      </TableToolbar>

      {loading && <HrLoading text="Cargando tu gestión laboral…" />}
      {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}
      {ready && (
        <>
          {activeWorkspace === 'ATTENDANCE' && (
            <div id="my-workforce-panel-attendance" className={form.stack} role="tabpanel" aria-label="Asistencia">
              <section id="mi-asistencia" aria-label="Mis resúmenes">
                <DataTable
                  stackOnMobile
                  ariaLabel="Mis resúmenes de asistencia"
                  rows={summaries}
                  rowKey={(summary) => summary.id}
                  pagination={{ mode: 'client' }}
                  minWidth="64rem"
                  toolbar={(
                    <TableToolbar actions={<Button variant="primary" size="sm" icon={Plus} onClick={() => setPanel({ kind: 'overtime' })} disabled={!online}>Horas extra</Button>}>
                      <span className={form.help}>Minutos calculados por el servidor, no por este dispositivo.</span>
                    </TableToolbar>
                  )}
                  empty={<EmptyState icon={Clock3} title="Sin resúmenes en el rango." />}
                  columns={[
                    { key: 'date', header: 'Fecha', render: (summary) => <span className={form.cellStack}><span className={form.cellTitle}>{summary.date}</span><span className={form.cellSub}>{summary.branch?.name ?? 'Sin sucursal'}</span></span> },
                    { key: 'ordinary', header: 'Ordinarios', type: 'number', render: (summary) => `${summary.ordinaryMinutes} min` },
                    { key: 'break', header: 'Descanso', type: 'number', render: (summary) => `${summary.breakMinutes} min` },
                    { key: 'late', header: 'Tardanza', type: 'number', render: (summary) => <span className={summary.lateMinutes > 0 ? form.cellWarning : undefined}>{summary.lateMinutes} min</span> },
                    { key: 'early', header: 'Salida temprana', type: 'number', render: (summary) => <span className={summary.earlyDepartureMinutes > 0 ? form.cellWarning : undefined}>{summary.earlyDepartureMinutes} min</span> },
                    { key: 'extra', header: 'Extra (aprobado / candidato)', type: 'number', render: (summary) => `${summary.approvedOvertimeMinutes ?? 0} / ${summary.candidateOvertimeMinutes} min` },
                    { key: 'status', header: 'Periodo', render: (summary) => (summary.periodStatus ? <WorkforceStatusPill status={summary.periodStatus} /> : <span className={form.cellSub}>Revisión {summary.sourceRevision ?? '—'}</span>) },
                    {
                      key: 'actions', header: 'Acciones', type: 'actions', width: '100px', render: (summary) => (
                        <div className={form.rowActions}>
                          <IconButton size="sm" icon={Pencil} tooltip="Corregir" label="Corregir" onClick={() => setPanel({ kind: 'correction', summary })} disabled={!online} />
                          <IconButton size="sm" icon={Clock3} tooltip="Horas extra" label="Solicitar extra" onClick={() => setPanel({ kind: 'overtime', summary })} disabled={!online} />
                        </div>
                      ),
                    },
                  ]}
                />
              </section>

              <div className={form.split}>
                <section className={form.panel} aria-label="Mis incidencias">
                  <FormSection title={`Mis incidencias (${workforce.incidents.length})`} description="Revisa el motivo antes de pedir corrección.">
                    {workforce.incidents.length === 0 ? <p className={form.help}>Sin incidencias.</p> : (
                      <ul className={form.list}>
                        {workforce.incidents.map((incident) => recordItem(
                          incident.id,
                          `${incident.date} · ${incident.type}`,
                          incident.message,
                          incident.reasonCode ?? 'Sin código adicional',
                          <>
                            <WorkforceStatusPill status={incident.status} />
                            <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: 'correction', incident })} disabled={!online}>Solicitar corrección</Button>
                          </>,
                        ))}
                      </ul>
                    )}
                  </FormSection>
                </section>
                <section className={form.panel} aria-label="Mis correcciones">
                  <FormSection title={`Mis correcciones (${workforce.corrections.length})`} description="Cada cambio conserva historial y actor.">
                    {workforce.corrections.length === 0 ? <p className={form.help}>Sin solicitudes.</p> : (
                      <ul className={form.list}>
                        {workforce.corrections.map((item) => recordItem(
                          item.id,
                          item.type,
                          item.reason,
                          item.auditReference ?? `Solicitud #${item.id}`,
                          <>
                            <WorkforceStatusPill status={item.status} />
                            {item.status === 'PENDING' && (
                              <Button size="sm" variant="ghost" onClick={() => openCancel({ kind: 'correction', item })} disabled={!online}>Cancelar</Button>
                            )}
                          </>,
                        ))}
                      </ul>
                    )}
                  </FormSection>
                </section>
              </div>
            </div>
          )}

          {activeWorkspace === 'REQUESTS' && (
            <div id="my-workforce-panel-requests" className={form.split} role="tabpanel" aria-label="Solicitudes">
              <section id="mis-horas-extra" className={form.panel} tabIndex={-1} aria-labelledby="mis-horas-extra-title">
                <FormSection title={`Mis horas extra (${workforce.overtimeRequests.length})`} description="Lo candidato y lo solicitado no sustituyen la decisión.">
                  <span id="mis-horas-extra-title" className="sr-only">Mis horas extra</span>
                  {workforce.overtimeRequests.length === 0 ? <p className={form.help}>Sin solicitudes.</p> : (
                    <ul className={form.list}>
                      {workforce.overtimeRequests.map((item) => recordItem(
                        item.id,
                        `${item.date} · ${item.requestedMinutes} min`,
                        item.reason,
                        `Aprobado por servidor: ${item.approvedMinutes ?? 0} min`,
                        <>
                          <WorkforceStatusPill status={item.status} />
                          {(item.status === 'DRAFT' || item.status === 'PENDING') && (
                            <Button size="sm" variant="ghost" onClick={() => openCancel({ kind: 'overtime', item })} disabled={!online}>Cancelar</Button>
                          )}
                        </>,
                      ))}
                    </ul>
                  )}
                </FormSection>
              </section>
              <section id="mis-permisos" className={form.panel} tabIndex={-1} aria-labelledby="mis-permisos-title">
                <FormSection title={`Mis permisos y vacaciones (${workforce.leaveRequests.length})`} description="Rango, fracción y estado autoritativo.">
                  <span id="mis-permisos-title" className="sr-only">Mis permisos y vacaciones</span>
                  {workforce.leaveRequests.length === 0 ? <p className={form.help}>Sin solicitudes.</p> : (
                    <ul className={form.list}>
                      {workforce.leaveRequests.map((item) => recordItem(
                        item.id,
                        item.leaveType?.name ?? `Tipo #${item.leaveTypeId}`,
                        `${item.startDate} – ${item.endDate} · ${item.fraction}`,
                        item.reason,
                        <>
                          <WorkforceStatusPill status={item.status} />
                          {item.status === 'DRAFT' && (
                            <Button variant="primary" size="sm" onClick={() => void submitLeave(item)} disabled={!online || saving}>Enviar</Button>
                          )}
                          {(item.status === 'DRAFT' || item.status === 'PENDING') && (
                            <Button size="sm" variant="ghost" onClick={() => openCancel({ kind: 'leave', item })} disabled={!online}>Cancelar</Button>
                          )}
                        </>,
                      ))}
                    </ul>
                  )}
                </FormSection>
              </section>
            </div>
          )}

          {activeWorkspace === 'BALANCES' && (
            <div id="my-workforce-panel-balances" className={form.split} role="tabpanel" aria-label="Vacaciones">
              <section id="mis-vacaciones" className={form.panel} aria-label="Mis saldos">
                <FormSection title={`Mis saldos (${workforce.vacationBalances.length})`} description="Disponibilidad emitida por el servidor.">
                  {workforce.vacationBalances.length === 0 ? <p className={form.help}>Sin saldos.</p> : (
                    <ul className={form.list}>
                      {workforce.vacationBalances.map((balance) => recordItem(
                        balance.id,
                        balance.leaveType?.name ?? balance.periodLabel ?? `Saldo #${balance.id}`,
                        `${formatHrNumber(balance.available)} ${balance.unit} disponibles`,
                        `Devengado ${formatHrNumber(balance.accrued)} · usado ${formatHrNumber(balance.used)} · pendiente ${formatHrNumber(balance.pending)} · al ${balance.asOf} · revisión ${balance.sourceRevision ?? '—'}`,
                        null,
                      ))}
                    </ul>
                  )}
                </FormSection>
              </section>
              <section className={form.panel} aria-label="Mi ledger">
                <FormSection title={`Mi ledger (${workforce.vacationLedger.length})`} description="Movimientos y resultado reportado.">
                  {workforce.vacationLedger.length === 0 ? <p className={form.help}>Sin movimientos.</p> : (
                    <ul className={form.list}>
                      {workforce.vacationLedger.map((entry) => recordItem(
                        entry.id,
                        `${entry.type} · ${formatHrNumber(entry.amount)} ${entry.unit}`,
                        entry.reason,
                        `${entry.effectiveDate} · ${entry.reference ?? `#${entry.id}`}`,
                        entry.resultingBalance != null ? <strong>{entry.resultingBalance} {entry.unit}</strong> : null,
                      ))}
                    </ul>
                  )}
                </FormSection>
              </section>
            </div>
          )}
        </>
      )}

      <FullScreenModal
        footer={<HrModalFooterSlot />}
        isOpen={Boolean(panel)}
        onClose={() => !saving && setPanel(null)}
        breadcrumb={['Mi RH', 'Gestión laboral']}
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
        footer={<HrModalFooterSlot />}
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
            <Textarea
              rows={5}
              maxLength={700}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              required
            />
          </label>
        </HrModalFormShell>
      </FullScreenModal>
    </PageContent>
  );
}
