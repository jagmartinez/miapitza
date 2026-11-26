import { formatHrNumber } from '../../utils/hrDisplay';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ListChecks,
  Eye,
  Pencil,
  Send,
  XCircle,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AppSelect, Button, Checkbox, DataTable, DateInput, EmptyState, FullScreenModal, Input, LoadErrorState, PageContent, PageHeader, SegmentedControl,
  StatCard, TableToolbar, Tabs, Textarea,
} from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import LeaveCalendarGrid from '../../components/hr/LeaveCalendarGrid';
import { collectAllPages } from '../../components/hr/collectAllPages';
import LeaveRequestForm from '../../components/hr/LeaveRequestForm';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
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
  HrBalanceUnit,
  HrDecision,
  HrLeaveCalendarEntry,
  HrLeaveRequest,
  HrLeaveRequestPayload,
  HrLeaveType,
  HrLeaveTypePayload,
  HrVacationBalance,
  HrVacationLedgerEntry,
} from '../../types/hr-workforce';
import form from '../../components/hr/hrForm.module.css';

const LOW_BALANCE_DAYS = 2;

const EMPTY_LOOKUPS: HrOrganizationCatalogs = {
  departments: [],
  positions: [],
  costCenters: [],
  branches: [],
  users: [],
};
const EMPTY_TYPE: HrLeaveTypePayload = {
  code: '',
  name: '',
  description: '',
  paid: true,
  active: true,
  balanceTracked: false,
  unit: 'DAYS',
  requiresAttachment: false,
};

function monthRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const value = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { dateFrom: value(from), dateTo: value(to) };
}

const fractionLabel = (value: string) => ({ FULL_DAY: 'Día completo', HALF_DAY: 'Medio día', HOURS: 'Por horas' }[value] ?? value);

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(parsed);
}

type Panel = 'request' | 'type' | 'adjustment' | null;
type RequestAction = { item: HrLeaveRequest; kind: 'decide' | 'cancel' } | null;
type LeaveTable = 'REQUESTS' | 'CALENDAR' | 'BALANCES' | 'TYPES' | 'HISTORY';

export default function LeaveManagement() {
  const online = useWorkforceOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const initialRange = monthRange();
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [userId, setUserId] = useState('');
  const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
  const [leaveTypes, setLeaveTypes] = useState<HrLeaveType[]>([]);
  const [requests, setRequests] = useState<HrLeaveRequest[]>([]);
  const [calendar, setCalendar] = useState<HrLeaveCalendarEntry[]>([]);
  const [balances, setBalances] = useState<HrVacationBalance[]>([]);
  const [ledger, setLedger] = useState<HrVacationLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
  const [typeForm, setTypeForm] = useState<HrLeaveTypePayload>(EMPTY_TYPE);
  const [requestAction, setRequestAction] = useState<RequestAction>(null);
  const [decision, setDecision] = useState<HrDecision>('APPROVED');
  const [actionReason, setActionReason] = useState('');
  const [adjustment, setAdjustment] = useState({
    userId: '',
    balanceId: '',
    effectiveDate: initialRange.dateTo,
    amount: '',
    unit: 'DAYS' as HrBalanceUnit,
    reason: '',
    reference: '',
  });
  const [activeTable, setActiveTable] = useState<LeaveTable>('REQUESTS');
  const [focusedRequestId, setFocusedRequestId] = useState<number | null>(null);
  // The Calendario tab can be read as a list or as an employee × day grid.
  const [calendarView, setCalendarView] = useState<'grid' | 'list'>('grid');
  const showCalendarGrid = activeTable === 'CALENDAR' && calendarView === 'grid';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters = { dateFrom, dateTo, userId: userId ? Number(userId) : undefined };
    try {
      const [
        organization,
        typesResult,
        requestResult,
        calendarResult,
        balanceResult,
        ledgerResult,
      ] = await Promise.all([
        hrClient.getOrganization(),
        workforceClient.getLeaveTypes(),
        collectAllPages((page) => workforceClient.getLeaveRequests({ ...filters, page, limit: 100 })),
        workforceClient.getLeaveCalendar(filters),
        collectAllPages((page) => workforceClient.getVacationBalances({ ...filters, page, limit: 100 })),
        collectAllPages((page) => workforceClient.getVacationLedger({ ...filters, page, limit: 100 })),
      ]);
      setLookups(organization);
      setLeaveTypes(typesResult);
      setRequests(requestResult);
      setCalendar(calendarResult);
      setBalances(balanceResult);
      setLedger(ledgerResult);
    } catch (loadError) {
      setLeaveTypes([]);
      setRequests([]);
      setCalendar([]);
      setBalances([]);
      setLedger([]);
      setError(getWorkforceErrorMessage(loadError, 'No fue posible cargar permisos y vacaciones.'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, userId]);

  useEffect(() => {
    void load();
  }, [load]);


  const users = (lookups.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );

  const createRequest = async (payload: HrLeaveRequestPayload) => {
    setSaving(true);
    try {
      await workforceClient.createLeaveRequest(payload);
      showSuccess('Borrador creado. Debe enviarse y luego decidirse; no hay autoaprobación.');
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible crear la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async (item: HrLeaveRequest) => {
    setSaving(true);
    try {
      await workforceClient.submitLeaveRequest(item.id);
      showSuccess('Solicitud enviada a aprobación.');
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible enviar la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const saveRequestAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requestAction || !actionReason.trim()) return;
    setSaving(true);
    try {
      if (requestAction.kind === 'decide')
        await workforceClient.decideLeaveRequest(requestAction.item.id, {
          decision,
          reason: actionReason.trim(),
        });
      else
        await workforceClient.cancelLeaveRequest(requestAction.item.id, {
          reason: actionReason.trim(),
        });
      showSuccess(
        requestAction.kind === 'decide'
          ? 'Decisión registrada.'
          : 'Solicitud cancelada con trazabilidad.'
      );
      setRequestAction(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible actualizar la solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const openType = (leaveType?: HrLeaveType) => {
    setEditingTypeId(leaveType?.id ?? null);
    setTypeForm(
      leaveType
        ? {
            code: leaveType.code,
            name: leaveType.name,
            description: leaveType.description ?? '',
            paid: leaveType.paid,
            active: leaveType.active,
            balanceTracked: leaveType.balanceTracked,
            unit: leaveType.unit,
            requiresAttachment: leaveType.requiresAttachment ?? false,
          }
        : EMPTY_TYPE
    );
    setPanel('type');
  };

  const saveType = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingTypeId) await workforceClient.updateLeaveType(editingTypeId, typeForm);
      else await workforceClient.createLeaveType(typeForm);
      showSuccess(editingTypeId ? 'Tipo actualizado.' : 'Tipo de ausencia creado.');
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible guardar el tipo.'));
    } finally {
      setSaving(false);
    }
  };

  const saveAdjustment = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await workforceClient.createVacationAdjustment(
        {
          userId: Number(adjustment.userId),
          ...(adjustment.balanceId ? { balanceId: Number(adjustment.balanceId) } : {}),
          effectiveDate: adjustment.effectiveDate,
          amount: Number(adjustment.amount),
          unit: adjustment.unit,
          reason: adjustment.reason.trim(),
          reference: adjustment.reference.trim() || undefined,
        },
        createWorkforceIdempotencyKey()
      );
      showSuccess('Ajuste agregado al ledger; el saldo mostrado vendrá del servidor.');
      setPanel(null);
      await load();
    } catch (mutationError) {
      showError(getWorkforceErrorMessage(mutationError, 'No fue posible registrar el ajuste.'));
    } finally {
      setSaving(false);
    }
  };

  const openRequestAction = (item: HrLeaveRequest, kind: 'decide' | 'cancel') => {
    setRequestAction({ item, kind });
    setDecision('APPROVED');
    setActionReason('');
  };

  const pendingCount = requests.filter((item) => item.status === 'PENDING').length;
  const draftCount = requests.filter((item) => item.status === 'DRAFT').length;
  const lowBalanceCount = new Set(
    balances.filter((balance) => balance.unit === 'DAYS' && Number(balance.available) <= LOW_BALANCE_DAYS).map((balance) => balance.userId)
  ).size;

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Ausencias']}
        title="Permisos y vacaciones"
        description="Aprueba solicitudes, consulta ausencias del equipo y controla los días disponibles"
        actions={
          <>
            <Button icon={SlidersHorizontal} onClick={() => openType()} disabled={!online}>Tipo</Button>
            <Button icon={SlidersHorizontal} onClick={() => setPanel('adjustment')} disabled={!online}>Ajustar</Button>
            <Button variant="primary" icon={Plus} onClick={() => setPanel('request')} disabled={!online}>Solicitud</Button>
          </>
        }
      />
      <OnlineOnlyNotice online={online} />
      {!loading && !error && (pendingCount > 0 || lowBalanceCount > 0) && (
        <section className={form.kpis} aria-label="Indicadores de permisos y vacaciones">
          {pendingCount > 0 && (
            <StatCard
              tone="warning"
              label="Solicitudes pendientes"
              value={String(pendingCount)}
              context={draftCount > 0 ? `${draftCount} borrador${draftCount === 1 ? '' : 'es'} sin enviar` : 'Esperan revisión'}
              action={{ label: 'Revisar solicitudes', onClick: () => setActiveTable('REQUESTS') }}
            />
          )}
          {lowBalanceCount > 0 && (
            <StatCard
              tone="danger"
              label="Saldo bajo"
              value={String(lowBalanceCount)}
              context={`Colaboradores con ≤ ${LOW_BALANCE_DAYS} días disponibles`}
              action={{ label: 'Ver saldos', onClick: () => setActiveTable('BALANCES') }}
            />
          )}
        </section>
      )}

      {!loading && !error && (
        <Tabs
          ariaLabel="Bandejas de permisos y vacaciones"
          active={activeTable}
          onChange={(id) => setActiveTable(id as LeaveTable)}
          tabs={([
            ['REQUESTS', 'Solicitudes', requests.filter((item) => item.status === 'PENDING').length],
            ['CALENDAR', 'Calendario', calendar.length],
            ['BALANCES', 'Saldos', balances.length],
            ['TYPES', 'Tipos de ausencia', leaveTypes.length],
            ['HISTORY', 'Movimientos', ledger.length],
          ] as Array<[LeaveTable, string, number]>).map(([id, label, badge]) => ({ id, label, badge }))}
        />
      )}

      <TableToolbar
        actions={(
          <>
            {!loading && !error && activeTable === 'CALENDAR' && (
              <SegmentedControl<'grid' | 'list'>
                ariaLabel="Vista del calendario"
                size="sm"
                options={[{ value: 'grid', label: 'Calendario' }, { value: 'list', label: 'Lista' }]}
                value={calendarView}
                onChange={setCalendarView}
              />
            )}
            <Button variant="ghost" icon={RefreshCw} onClick={() => void load()}>Actualizar</Button>
          </>
        )}
      >
        <DateInput aria-label="Desde" title="Desde" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <DateInput aria-label="Hasta" title="Hasta" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <AppSelect<string>
          options={[
            { value: '', label: 'Todos los empleados' },
            ...users.map((user) => ({ value: String(user.id), label: user.name })),
          ]}
          value={userId}
          onChange={(next) => setUserId(next ?? '')}
          aria-label="Filtrar por empleado"
          isClearable={false}
        />
      </TableToolbar>

      {loading && <HrLoading text="Cargando permisos y vacaciones…" />}
      {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && showCalendarGrid && (
        <section className={form.frame} id={`leave-panel-${activeTable.toLowerCase()}`} role="tabpanel" aria-label="Calendario de ausencias">
          <LeaveCalendarGrid
            entries={calendar}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onOpenRequest={(leaveRequestId) => { setFocusedRequestId(leaveRequestId); setActiveTable('REQUESTS'); }}
          />
        </section>
      )}
      {!loading && !error && !showCalendarGrid && (
        <div className={form.stack} role="tabpanel" id={`leave-panel-${activeTable.toLowerCase()}`} aria-label="Administración de permisos y vacaciones">
            {activeTable === 'REQUESTS' && (
              <DataTable
                ariaLabel="Solicitudes de permisos y vacaciones"
                rows={requests}
                rowKey={(item) => item.id}
                pagination={{ mode: 'client' }}
                minWidth="56rem"
                rowTone={(item) => (focusedRequestId === item.id ? 'primary' : undefined)}
                empty={<EmptyState title="No hay solicitudes en este periodo" description="Puedes registrar una solicitud en nombre de un empleado." action={<Button variant="primary" size="sm" onClick={() => setPanel('request')} disabled={!online} aria-label="Crear ausencia"><Plus size={15} /> Nueva solicitud</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
                  { key: 'c1', header: 'Tipo', render: (item) => <>{item.leaveType?.name ?? `Tipo #${item.leaveTypeId}`}</> },
                  { key: 'c2', header: 'Fechas', render: (item) => <span className={form.cellStack}><span>{dateLabel(item.startDate)}</span><span className={form.cellSub}>{item.endDate !== item.startDate ? `hasta ${dateLabel(item.endDate)}` : 'Un día'}</span></span> },
                  { key: 'c3', header: 'Duración', render: (item) => <span className={form.cellStack}><span>{fractionLabel(item.fraction)}</span>{item.requestedAmount != null && <span className={form.cellSub}>{formatHrNumber(item.requestedAmount)} {item.balanceUnit ?? ''}</span>}</span> },
                  { key: 'c4', header: 'Motivo', render: (item) => <>{item.reason}</> },
                  { key: 'c5', header: 'Estado', render: (item) => <><WorkforceStatusPill status={item.status} /></> },
                  { key: 'c6', header: 'Acciones', width: '6rem', type: 'actions', render: (item) => <div className={form.rowActions}>{item.status === 'DRAFT' && <Button size="sm" variant="ghost" onClick={() => void submitDraft(item)} disabled={!online || saving} title="Enviar solicitud" aria-label={`Enviar solicitud de ${item.user?.name ?? item.userId}`} icon={Send} />}{item.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => openRequestAction(item, 'decide')} disabled={!online} title="Revisar solicitud" aria-label={`Revisar solicitud de ${item.user?.name ?? item.userId}`} icon={Eye} />}{(item.status === 'DRAFT' || item.status === 'PENDING') && <Button size="sm" variant="ghost" onClick={() => openRequestAction(item, 'cancel')} disabled={!online} title="Cancelar solicitud" aria-label={`Cancelar solicitud de ${item.user?.name ?? item.userId}`} icon={XCircle} />}{!['DRAFT', 'PENDING'].includes(item.status) && <span className={form.cellSub}>Finalizada</span>}</div> },
                ]}
              />
            )}

            {activeTable === 'CALENDAR' && (
              <DataTable
                ariaLabel={`Ausencias aprobadas entre ${dateLabel(dateFrom)} y ${dateLabel(dateTo)}`}
                rows={calendar}
                rowKey={(entry) => entry.id}
                pagination={{ mode: 'client' }}
                minWidth="56rem"
                empty={<EmptyState title="No hay ausencias aprobadas" description="Amplía el rango de fechas o revisa las solicitudes pendientes." action={<Button size="sm" variant="ghost" onClick={() => setActiveTable('REQUESTS')}>Ver solicitudes</Button>} />}
                columns={[
                  { key: 'c0', header: 'Fecha', render: (entry) => <strong>{dateLabel(entry.date)}</strong> },
                  { key: 'c1', header: 'Empleado', render: (entry) => <>{entry.user?.name ?? `Usuario #${entry.userId}`}</> },
                  { key: 'c2', header: 'Tipo', render: (entry) => <>{entry.leaveType?.name ?? `Tipo #${entry.leaveTypeId}`}</> },
                  { key: 'c3', header: 'Duración', render: (entry) => <>{fractionLabel(entry.fraction)}</> },
                  { key: 'c4', header: 'Sucursal', render: (entry) => <>{entry.branch?.name ?? 'Sin sucursal'}</> },
                  { key: 'c5', header: 'Estado', render: (entry) => <><WorkforceStatusPill status={entry.status} /></> },
                  { key: 'c6', header: 'Acción', width: '6rem', type: 'actions', render: (entry) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => { setFocusedRequestId(entry.leaveRequestId); setActiveTable('REQUESTS'); }} title="Ver solicitud" aria-label={`Ver solicitud de ${entry.user?.name ?? entry.userId}`} icon={Eye} /></div> },
                ]}
              />
            )}

            {activeTable === 'BALANCES' && (
              <DataTable
                ariaLabel="Saldos disponibles por empleado"
                rows={balances}
                rowKey={(balance) => balance.id}
                pagination={{ mode: 'client' }}
                minWidth="72rem"
                empty={<EmptyState title="No hay saldos configurados" description="Registra un ajuste inicial para comenzar el control." action={<Button variant="primary" size="sm" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button>} />}
                columns={[
                  { key: 'c0', header: 'Empleado', render: (balance) => <strong>{balance.user?.name ?? `Usuario #${balance.userId}`}</strong> },
                  { key: 'c1', header: 'Tipo', render: (balance) => <>{balance.leaveType?.name ?? 'Vacaciones'}</> },
                  { key: 'c2', header: 'Periodo', render: (balance) => <>{balance.periodLabel ?? 'Vigente'}</> },
                  { key: 'c3', header: 'Devengado', render: (balance) => <>{formatHrNumber(balance.accrued)} {balance.unit}</> },
                  { key: 'c4', header: 'Usado', render: (balance) => <>{formatHrNumber(balance.used)} {balance.unit}</> },
                  { key: 'c5', header: 'Pendiente', render: (balance) => <>{formatHrNumber(balance.pending)} {balance.unit}</> },
                  { key: 'c6', header: 'Disponible', render: (balance) => <strong>{formatHrNumber(balance.available)} {balance.unit}</strong> },
                  { key: 'c7', header: 'Actualizado', render: (balance) => <>{dateLabel(balance.asOf)}</> },
                  { key: 'c8', header: 'Acción', width: '6rem', type: 'actions', render: (balance) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(balance.userId), balanceId: String(balance.id), unit: balance.unit })); setPanel('adjustment'); }} disabled={!online} title="Ajustar saldo" aria-label={`Ajustar saldo de ${balance.user?.name ?? balance.userId}`} icon={SlidersHorizontal} /></div> },
                ]}
              />
            )}

            {activeTable === 'TYPES' && (
              <DataTable
                ariaLabel="Tipos de ausencia disponibles"
                rows={leaveTypes}
                rowKey={(type) => type.id}
                pagination={{ mode: 'client' }}
                minWidth="64rem"
                empty={<EmptyState title="No hay tipos de ausencia" description="Crea vacaciones, permisos, subsidios u otras políticas." action={<Button variant="primary" size="sm" onClick={() => openType()} disabled={!online}><Plus size={15} /> Crear tipo</Button>} />}
                columns={[
                  { key: 'c0', header: 'Nombre', render: (type) => <span className={form.cellStack}><span className={form.cellTitle}>{type.name}</span><span className={form.cellSub}>{type.description || 'Sin descripción'}</span></span> },
                  { key: 'c1', header: 'Código', render: (type) => <code>{type.code}</code> },
                  { key: 'c2', header: 'Pago', render: (type) => <>{type.paid ? 'Remunerado' : 'No remunerado'}</> },
                  { key: 'c3', header: 'Control de saldo', render: (type) => <>{type.balanceTracked ? 'Sí, descuenta saldo' : 'No'}</> },
                  { key: 'c4', header: 'Unidad', render: (type) => <>{type.unit}</> },
                  { key: 'c5', header: 'Adjunto', render: (type) => <>{type.requiresAttachment ? 'Obligatorio' : 'Opcional'}</> },
                  { key: 'c6', header: 'Estado', render: (type) => <><WorkforceStatusPill status={type.active ? 'ACTIVE' : 'INACTIVE'} /></> },
                  { key: 'c7', header: 'Acción', width: '6rem', type: 'actions', render: (type) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => openType(type)} disabled={!online} title="Editar tipo" aria-label={`Editar ${type.name}`} icon={Pencil} /></div> },
                ]}
              />
            )}

            {activeTable === 'HISTORY' && (
              <DataTable
                ariaLabel="Movimientos de saldos"
                rows={ledger}
                rowKey={(entry) => entry.id}
                pagination={{ mode: 'client' }}
                minWidth="64rem"
                empty={<EmptyState title="No hay movimientos" description="Los devengos, usos y ajustes aparecerán aquí." action={<Button size="sm" variant="ghost" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button>} />}
                columns={[
                  { key: 'c0', header: 'Fecha', render: (entry) => <>{dateLabel(entry.effectiveDate)}</> },
                  { key: 'c1', header: 'Empleado', render: (entry) => <>{users.find((user) => user.id === entry.userId)?.name ?? `Usuario #${entry.userId}`}</> },
                  { key: 'c2', header: 'Movimiento', render: (entry) => <>{entry.type}</> },
                  { key: 'c3', header: 'Cantidad', render: (entry) => <>{formatHrNumber(entry.amount)} {entry.unit}</> },
                  { key: 'c4', header: 'Motivo', render: (entry) => <>{entry.reason}</> },
                  { key: 'c5', header: 'Referencia', render: (entry) => <>{entry.reference ?? `Movimiento #${entry.id}`}</> },
                  { key: 'c6', header: 'Saldo resultante', render: (entry) => <>{entry.resultingBalance != null ? `${formatHrNumber(entry.resultingBalance)} ${entry.unit}` : '—'}</> },
                  { key: 'c7', header: 'Acción', width: '6rem', type: 'actions', render: (entry) => <div className={form.rowActions}><Button size="sm" variant="ghost" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(entry.userId), balanceId: String(entry.balanceId), unit: entry.unit })); setPanel('adjustment'); }} disabled={!online} title="Ajustar saldo" aria-label={`Ajustar saldo del movimiento ${entry.id}`} icon={SlidersHorizontal} /></div> },
                ]}
              />
            )}
        </div>
      )}
      <FullScreenModal
        isOpen={Boolean(panel)}
        onClose={() => !saving && setPanel(null)}
        breadcrumb={['Recursos humanos', 'Ausencias']}
        title={
          panel === 'request'
            ? 'Nueva solicitud'
            : panel === 'type'
              ? 'Tipo de ausencia'
              : 'Ajuste de vacaciones'
        }
      >
        {panel === 'request' && (
          <LeaveRequestForm
            users={users}
            leaveTypes={leaveTypes}
            online={online}
            saving={saving}
            notice={<OnlineOnlyNotice online={online} compact />}
            onSubmit={createRequest}
            onCancel={() => setPanel(null)}
          />
        )}
        {panel === 'type' && (
          <HrModalFormShell
            ariaLabel="Sección de tipo de ausencia"
            tabLabel="Tipo"
            sectionTitle="Identidad y comportamiento del permiso"
            icon={<ListChecks size={18} aria-hidden="true" />}
            formClassName="hr-workforce-form"
            notice={<OnlineOnlyNotice online={online} compact />}
            onSubmit={(event) => void saveType(event)}
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
                  Cancelar
                </Button>
                <Button variant="primary" type="submit" disabled={!online || saving}>
                  {saving ? 'Guardando…' : 'Guardar tipo'}
                </Button>
              </>
            }
          >
            <label>
              Código
              <Input
                value={typeForm.code}
                onChange={(event) =>
                  setTypeForm((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }))
                }
                required
              />
            </label>
            <label>
              Nombre
              <Input
                value={typeForm.name}
                onChange={(event) =>
                  setTypeForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Unidad
              <AppSelect<string>
                options={[
                  { value: 'DAYS', label: 'Días' },
                  { value: 'HOURS', label: 'Horas' },
                  { value: 'MINUTES', label: 'Minutos' },
                ]}
                value={typeForm.unit}
                onChange={(next) =>
                  setTypeForm((current) => ({
                    ...current,
                    unit: (next ?? '') as HrBalanceUnit,
                  }))
                }
                isClearable={false}
              />
            </label>
            <label className="span-full">
              Descripción
              <Textarea
                rows={3}
                value={typeForm.description}
                onChange={(event) =>
                  setTypeForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <div className={`${form.checkGrid} span-full`}>
              <Checkbox checked={typeForm.paid}
                  onChange={(event) =>
                    setTypeForm((current) => ({ ...current, paid: event.target.checked }))
                  } label={<>Remunerada</>} />
              <Checkbox checked={typeForm.balanceTracked}
                  onChange={(event) =>
                    setTypeForm((current) => ({
                      ...current,
                      balanceTracked: event.target.checked,
                    }))
                  } label={<>Controla saldo</>} />
              <Checkbox checked={typeForm.requiresAttachment}
                  onChange={(event) =>
                    setTypeForm((current) => ({
                      ...current,
                      requiresAttachment: event.target.checked,
                    }))
                  } label={<>Requiere soporte</>} />
              <Checkbox checked={typeForm.active}
                  onChange={(event) =>
                    setTypeForm((current) => ({ ...current, active: event.target.checked }))
                  } label={<>Activo</>} />
            </div>
          </HrModalFormShell>
        )}
        {panel === 'adjustment' && (
          <HrModalFormShell
            ariaLabel="Sección de ajuste de vacaciones"
            tabLabel="Ajuste"
            sectionTitle="Saldo, movimiento y trazabilidad"
            icon={<SlidersHorizontal size={18} aria-hidden="true" />}
            formClassName="hr-workforce-form"
            notice={<OnlineOnlyNotice online={online} compact />}
            onSubmit={(event) => void saveAdjustment(event)}
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
                  Cancelar
                </Button>
                <Button variant="primary"
                  type="submit"
                  disabled={
                    !online ||
                    saving ||
                    !adjustment.userId ||
                    !adjustment.amount ||
                    !adjustment.reason.trim()
                  }
                >
                  {saving ? 'Registrando…' : 'Registrar ajuste'}
                </Button>
              </>
            }
          >
            <label>
              Usuario
              <AppSelect<string>
                options={[
                  { value: '', label: 'Seleccionar…' },
                  ...users.map((user) => ({ value: String(user.id), label: user.name })),
                ]}
                value={adjustment.userId}
                onChange={(next) =>
                  setAdjustment((current) => ({
                    ...current,
                    userId: next ?? '',
                    balanceId: '',
                  }))
                }
                isClearable={false}
              />
            </label>
            <label>
              Saldo objetivo
              <AppSelect<string>
                options={[
                  { value: '', label: 'Resolver en servidor' },
                  ...balances
                    .filter((balance) => String(balance.userId) === adjustment.userId)
                    .map((balance) => ({
                      value: String(balance.id),
                      label: `${balance.periodLabel ?? `Saldo #${balance.id}`} · ${balance.unit}`,
                    })),
                ]}
                value={adjustment.balanceId}
                onChange={(next) => {
                  const balance = balances.find((item) => String(item.id) === (next ?? ''));
                  setAdjustment((current) => ({
                    ...current,
                    balanceId: next ?? '',
                    unit: balance?.unit ?? current.unit,
                  }));
                }}
                isClearable={false}
              />
            </label>
            <label>
              Fecha efectiva
              <DateInput
               
                value={adjustment.effectiveDate}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, effectiveDate: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Cantidad con signo
              <Input
                type="number"
                step="0.01"
                value={adjustment.amount}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, amount: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Unidad
              <AppSelect<string>
                options={[
                  { value: 'DAYS', label: 'Días' },
                  { value: 'HOURS', label: 'Horas' },
                  { value: 'MINUTES', label: 'Minutos' },
                ]}
                value={adjustment.unit}
                onChange={(next) =>
                  setAdjustment((current) => ({
                    ...current,
                    unit: (next ?? '') as HrBalanceUnit,
                  }))
                }
                isClearable={false}
              />
            </label>
            <label>
              Referencia
              <Input
                value={adjustment.reference}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, reference: event.target.value }))
                }
              />
            </label>
            <label className="span-full">
              Razón obligatoria
              <Textarea
                rows={4}
                maxLength={700}
                value={adjustment.reason}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, reason: event.target.value }))
                }
                required
              />
            </label>
            <div className={`${form.alertWarning} span-full`}>
              <AlertTriangle size={18} />
              <span>
                El ajuste crea un movimiento de ledger; no edita ni recalcula el saldo en el
                navegador.
              </span>
            </div>
          </HrModalFormShell>
        )}
      </FullScreenModal>

      <FullScreenModal
        isOpen={Boolean(requestAction)}
        onClose={() => !saving && setRequestAction(null)}
        title={requestAction?.kind === 'cancel' ? 'Cancelar solicitud' : 'Decidir solicitud'}
      >
        <HrModalFormShell
          ariaLabel="Sección de resolución de solicitud"
          tabLabel={requestAction?.kind === 'cancel' ? 'Cancelación' : 'Decisión'}
          sectionTitle="Resolución y justificación"
          icon={requestAction?.kind === 'cancel' ? <XCircle size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          formClassName="hr-workforce-form"
          notice={<OnlineOnlyNotice online={online} compact />}
          onSubmit={(event) => void saveRequestAction(event)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setRequestAction(null)}>Volver</Button>
              <Button variant="primary" type="submit" disabled={!online || saving || !actionReason.trim()}>{saving ? 'Registrando…' : 'Confirmar'}</Button>
            </>
          }
        >
          {requestAction?.kind === 'decide' && (
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
          <label className="span-full">
            Razón obligatoria
            <Textarea
              rows={5}
              maxLength={700}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              required
            />
          </label>
          <p className="hr-form-help span-full">
            La decisión no se infiere al guardar ni al enviar; queda registrada como una transición
            separada.
          </p>
        </HrModalFormShell>
      </FullScreenModal>
    </PageContent>
  );
}
