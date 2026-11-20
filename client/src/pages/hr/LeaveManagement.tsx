import HrReactSelect from '../../components/hr/HrReactSelect';
import { formatHrNumber } from '../../utils/hrFormat';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ListChecks,
  Eye,
  Pencil,
  Send,
  XCircle,
  Inbox,
  Wallet,
  Tags,
  History,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import CatalogTable, { type CatalogColumn } from '../../components/CatalogTable';
import Sidebar from '../../components/Sidebar';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import { collectAllPages } from '../../components/hr/collectAllPages';
import LeaveRequestForm from '../../components/hr/LeaveRequestForm';
import LeaveCalendarGrid from '../../components/hr/LeaveCalendarGrid';
import { HrHero, HrPage, HrPanelState, HrSection, HrTablePanel, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
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
import './workforce.css';
import './admin-tables.css';
import './hr-admin-operations.css';
import '../Inventory.css';
import './layouts/ausencias.css';

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
const PAGE_SIZE = 12;
const LOW_BALANCE_DAYS = 2;
// Adapts the Lucide icon to the RH kit's narrower icon prop type.
const LeaveHeroIcon = ({ size }: { size?: number }) => <CalendarDays size={size} aria-hidden="true" />;

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
  // The Calendario tab can be read as a list or as an employee × day grid.
  const [calendarView, setCalendarView] = useState<'grid' | 'list'>('grid');
  const showCalendarGrid = activeTable === 'CALENDAR' && calendarView === 'grid';
  const [focusedRequestId, setFocusedRequestId] = useState<number | null>(null);
  const [tablePage, setTablePage] = useState(1);

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

  useEffect(() => { setTablePage(1); }, [activeTable, dateFrom, dateTo, userId]);

  const users = (lookups.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );
  const activeTableCount = activeTable === 'REQUESTS' ? requests.length
    : activeTable === 'CALENDAR' ? calendar.length
      : activeTable === 'BALANCES' ? balances.length
        : activeTable === 'TYPES' ? leaveTypes.length
          : ledger.length;
  const pageSlice = <T,>(items: T[]) => items.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);
  useEffect(() => { setTablePage((page) => Math.min(page, Math.max(1, Math.ceil(activeTableCount / PAGE_SIZE)))); }, [activeTableCount]);

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
  const dayBalances = balances.filter((balance) => balance.unit === 'DAYS');
  const balancesWithDays = new Set(
    dayBalances.filter((balance) => Number(balance.available) > 0).map((balance) => balance.userId)
  ).size;
  const lowBalanceCount = new Set(
    dayBalances.filter((balance) => Number(balance.available) <= LOW_BALANCE_DAYS).map((balance) => balance.userId)
  ).size;
  const dataReady = !loading && !error;
  const factValue = (value: React.ReactNode) => (dataReady ? value : '—');
  const facts: HrFact[] = [
    {
      label: 'Solicitudes pendientes',
      value: factValue(pendingCount),
      hint: draftCount > 0 ? `${draftCount} borrador${draftCount === 1 ? '' : 'es'} sin enviar` : 'Esperan revisión',
      tone: dataReady && pendingCount > 0 ? 'warning' : 'default',
    },
    {
      label: 'Ausencias aprobadas',
      value: factValue(calendar.length),
      hint: `${dateLabel(dateFrom)} – ${dateLabel(dateTo)}`,
      tone: 'accent',
    },
    {
      label: 'Con días disponibles',
      value: factValue(balancesWithDays),
      hint: `${balances.length} saldo${balances.length === 1 ? '' : 's'} calculados por el servidor`,
      tone: 'success',
    },
    {
      label: 'Saldo bajo',
      value: factValue(lowBalanceCount),
      hint: `Colaboradores con ≤ ${LOW_BALANCE_DAYS} días`,
      tone: dataReady && lowBalanceCount > 0 ? 'danger' : 'default',
    },
  ];
  const tabItems: Array<[LeaveTable, string, number, typeof CalendarDays]> = [
    ['REQUESTS', 'Solicitudes', pendingCount, Inbox],
    ['CALENDAR', 'Calendario', calendar.length, CalendarDays],
    ['BALANCES', 'Saldos', balances.length, Wallet],
    ['TYPES', 'Tipos de ausencia', leaveTypes.length, Tags],
    ['HISTORY', 'Movimientos', ledger.length, History],
  ];
  const panelId = `leave-panel-${activeTable.toLowerCase()}`;
  const tabId = `leave-tab-${activeTable.toLowerCase()}`;
  const tablePagination = {
    page: tablePage,
    totalPages: Math.max(1, Math.ceil(activeTableCount / PAGE_SIZE)),
    totalItems: activeTableCount,
    pageSize: PAGE_SIZE,
    onPageChange: setTablePage,
  };

  const requestColumns: CatalogColumn<HrLeaveRequest>[] = [
    { key: 'user', header: 'Empleado', render: (item) => <strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong> },
    { key: 'type', header: 'Tipo', render: (item) => item.leaveType?.name ?? `Tipo #${item.leaveTypeId}` },
    { key: 'dates', header: 'Fechas', render: (item) => <>{dateLabel(item.startDate)}<small>{item.endDate !== item.startDate ? `hasta ${dateLabel(item.endDate)}` : 'Un día'}</small></> },
    { key: 'duration', header: 'Duración', render: (item) => <>{fractionLabel(item.fraction)}{item.requestedAmount != null && <small>{formatHrNumber(item.requestedAmount)} {item.balanceUnit ?? ''}</small>}</> },
    { key: 'reason', header: 'Motivo', render: (item) => item.reason },
    { key: 'status', header: 'Estado', render: (item) => <WorkforceStatusPill status={item.status} /> },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (item) => (
        <div className="hr-admin-row-actions table-actions">
          {item.status === 'DRAFT' && <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void submitDraft(item)} disabled={!online || saving} title="Enviar solicitud" aria-label={`Enviar solicitud de ${item.user?.name ?? item.userId}`}><Send size={16} /></Button>}
          {item.status === 'PENDING' && <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openRequestAction(item, 'decide')} disabled={!online} title="Revisar solicitud" aria-label={`Revisar solicitud de ${item.user?.name ?? item.userId}`}><Eye size={16} /></Button>}
          {(item.status === 'DRAFT' || item.status === 'PENDING') && <Button className="table-action-btn danger" size="sm" variant="ghost" onClick={() => openRequestAction(item, 'cancel')} disabled={!online} title="Cancelar solicitud" aria-label={`Cancelar solicitud de ${item.user?.name ?? item.userId}`}><XCircle size={16} /></Button>}
          {!['DRAFT', 'PENDING'].includes(item.status) && <span className="hr-admin-muted">Finalizada</span>}
        </div>
      ),
    },
  ];

  const calendarColumns: CatalogColumn<HrLeaveCalendarEntry>[] = [
    { key: 'date', header: 'Fecha', render: (entry) => <strong>{dateLabel(entry.date)}</strong> },
    { key: 'user', header: 'Empleado', render: (entry) => entry.user?.name ?? `Usuario #${entry.userId}` },
    { key: 'type', header: 'Tipo', render: (entry) => entry.leaveType?.name ?? `Tipo #${entry.leaveTypeId}` },
    { key: 'duration', header: 'Duración', render: (entry) => fractionLabel(entry.fraction) },
    { key: 'branch', header: 'Sucursal', render: (entry) => entry.branch?.name ?? 'Sin sucursal' },
    { key: 'status', header: 'Estado', render: (entry) => <WorkforceStatusPill status={entry.status} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (entry) => (
        <div className="table-actions">
          <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => { setFocusedRequestId(entry.leaveRequestId); setActiveTable('REQUESTS'); }} title="Ver solicitud" aria-label={`Ver solicitud de ${entry.user?.name ?? entry.userId}`}><Eye size={16} /></Button>
        </div>
      ),
    },
  ];

  const balanceColumns: CatalogColumn<HrVacationBalance>[] = [
    { key: 'user', header: 'Empleado', render: (balance) => <strong>{balance.user?.name ?? `Usuario #${balance.userId}`}</strong> },
    { key: 'type', header: 'Tipo', render: (balance) => balance.leaveType?.name ?? 'Vacaciones' },
    { key: 'period', header: 'Periodo', render: (balance) => balance.periodLabel ?? 'Vigente' },
    { key: 'accrued', header: 'Devengado', render: (balance) => <>{formatHrNumber(balance.accrued)} {balance.unit}</> },
    { key: 'used', header: 'Usado', render: (balance) => <>{formatHrNumber(balance.used)} {balance.unit}</> },
    { key: 'pending', header: 'Pendiente', render: (balance) => <>{formatHrNumber(balance.pending)} {balance.unit}</> },
    { key: 'available', header: 'Disponible', render: (balance) => <strong>{formatHrNumber(balance.available)} {balance.unit}</strong> },
    { key: 'asOf', header: 'Actualizado', render: (balance) => dateLabel(balance.asOf) },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (balance) => (
        <div className="table-actions">
          <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(balance.userId), balanceId: String(balance.id), unit: balance.unit })); setPanel('adjustment'); }} disabled={!online} title="Ajustar saldo" aria-label={`Ajustar saldo de ${balance.user?.name ?? balance.userId}`}><SlidersHorizontal size={16} /></Button>
        </div>
      ),
    },
  ];

  const typeColumns: CatalogColumn<HrLeaveType>[] = [
    { key: 'name', header: 'Nombre', render: (type) => <><strong>{type.name}</strong><small>{type.description || 'Sin descripción'}</small></> },
    { key: 'code', header: 'Código', render: (type) => <code>{type.code}</code> },
    { key: 'paid', header: 'Pago', render: (type) => (type.paid ? 'Remunerado' : 'No remunerado') },
    { key: 'balance', header: 'Control de saldo', render: (type) => (type.balanceTracked ? 'Sí, descuenta saldo' : 'No') },
    { key: 'unit', header: 'Unidad', render: (type) => type.unit },
    { key: 'attachment', header: 'Adjunto', render: (type) => (type.requiresAttachment ? 'Obligatorio' : 'Opcional') },
    { key: 'status', header: 'Estado', render: (type) => <WorkforceStatusPill status={type.active ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (type) => (
        <div className="table-actions">
          <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openType(type)} disabled={!online} title="Editar tipo" aria-label={`Editar ${type.name}`}><Pencil size={16} /></Button>
        </div>
      ),
    },
  ];

  const ledgerColumns: CatalogColumn<HrVacationLedgerEntry>[] = [
    { key: 'date', header: 'Fecha', render: (entry) => dateLabel(entry.effectiveDate) },
    { key: 'user', header: 'Empleado', render: (entry) => users.find((user) => user.id === entry.userId)?.name ?? `Usuario #${entry.userId}` },
    { key: 'type', header: 'Movimiento', render: (entry) => entry.type },
    { key: 'amount', header: 'Cantidad', render: (entry) => <>{formatHrNumber(entry.amount)} {entry.unit}</> },
    { key: 'reason', header: 'Motivo', render: (entry) => entry.reason },
    { key: 'reference', header: 'Referencia', render: (entry) => entry.reference ?? `Movimiento #${entry.id}` },
    { key: 'resulting', header: 'Saldo resultante', render: (entry) => (entry.resultingBalance != null ? `${formatHrNumber(entry.resultingBalance)} ${entry.unit}` : '—') },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (entry) => (
        <div className="table-actions">
          <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(entry.userId), balanceId: String(entry.balanceId), unit: entry.unit })); setPanel('adjustment'); }} disabled={!online} title="Ajustar saldo" aria-label={`Ajustar saldo del movimiento ${entry.id}`}><SlidersHorizontal size={16} /></Button>
        </div>
      ),
    },
  ];

  // Filters are declared before the tab bar; the tab bar renders above them.
  const filterToolbar = (
    <HrToolbar className="hr-workforce-filters inventory-filters-row hr-operation-toolbar hr-aus-toolbar" ariaLabel="Filtros de permisos y vacaciones">
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
      <label className="is-wide">
        Empleado
        <HrReactSelect value={userId} onChange={(event) => setUserId(event.target.value)} isSearchable aria-label="Filtrar por empleado">
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
  );

  const tabBar = (dataReady || activeTable === 'CALENDAR') && (
    <nav className="hr-ws-tabs-bar hr-aus-tabs-bar" aria-label="Bandejas de permisos y vacaciones">
      {dataReady && (
        <div className="hr-ws-tabs filters-toolbar hr-admin-tab-toolbar" role="tablist" aria-label="Bandejas de permisos y vacaciones">
          {tabItems.map(([value, label, count, Icon]) => (
            <button key={value} type="button" role="tab" id={`leave-tab-${value.toLowerCase()}`} aria-controls={`leave-panel-${value.toLowerCase()}`} aria-selected={activeTable === value} className={activeTable === value ? 'active' : undefined} onClick={() => setActiveTable(value)}>
              <Icon size={16} aria-hidden="true" />
              {label}
              <small>{count}</small>
            </button>
          ))}
        </div>
      )}
      {activeTable === 'CALENDAR' && (
        <div className="hr-ws-tabs-trailing">
          <div className="leave-calendar-view-toggle hr-aus-view-toggle" role="group" aria-label="Vista del calendario">
            <button type="button" className={calendarView === 'grid' ? 'active' : ''} aria-pressed={calendarView === 'grid'} onClick={() => setCalendarView('grid')} title="Ver como calendario">
              <CalendarDays size={16} /> Calendario
            </button>
            <button type="button" className={calendarView === 'list' ? 'active' : ''} aria-pressed={calendarView === 'list'} onClick={() => setCalendarView('list')} title="Ver como lista">
              <ListChecks size={16} /> Lista
            </button>
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <HrPage className="inventory-page hr-workforce-page hr-leave-management-page hr-admin-catalog-page hr-operation-page hr-ausencias">
      <div className="hr-aus-hero inventory-header-new">
        <HrHero
          eyebrow="Recursos humanos"
          icon={LeaveHeroIcon}
          title="Permisos y vacaciones"
          subtitle="Aprueba solicitudes, consulta ausencias del equipo y controla los días disponibles"
          actions={
            <>
              <Button variant="secondary" onClick={() => openType()} disabled={!online}>
                <SlidersHorizontal size={17} /> Tipo
              </Button>
              <Button variant="secondary" onClick={() => setPanel('adjustment')} disabled={!online}>
                <SlidersHorizontal size={17} /> Ajustar
              </Button>
              <Button onClick={() => setPanel('request')} disabled={!online}>
                <Plus size={17} /> Solicitud
              </Button>
            </>
          }
          facts={facts}
        />
      </div>
      <OnlineOnlyNotice online={online} />
      {tabBar}
      {filterToolbar}

      {loading && <HrPanelState><LoadingSpinner text="Cargando permisos y vacaciones…" /></HrPanelState>}
      {!loading && error && (
        <HrPanelState role="alert">
          <AlertTriangle size={42} />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </HrPanelState>
      )}
      {!loading && !error && showCalendarGrid && (
        <HrSection
          flush
          className="hr-aus-section"
          id={panelId}
          role="tabpanel"
          aria-labelledby={tabId}
        >
          <LeaveCalendarGrid
            entries={calendar}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onOpenRequest={(leaveRequestId) => { setFocusedRequestId(leaveRequestId); setActiveTable('REQUESTS'); }}
          />
        </HrSection>
      )}
      {!loading && !error && !showCalendarGrid && (
        <HrTablePanel id={panelId} role="tabpanel" aria-labelledby={tabId} className="hr-aus-table-panel">
          {activeTable === 'REQUESTS' && (
            <CatalogTable<HrLeaveRequest>
              className="hr-aus-table"
              ariaLabel="Solicitudes de permisos y vacaciones"
              rows={pageSlice(requests)}
              rowKey={(item) => item.id}
              rowClassName={(item) => (focusedRequestId === item.id ? 'is-selected' : undefined)}
              columns={requestColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay solicitudes en este periodo</strong><span>Puedes registrar una solicitud en nombre de un empleado.</span><Button size="sm" onClick={() => setPanel('request')} disabled={!online} aria-label="Crear ausencia"><Plus size={15} /> Nueva solicitud</Button></div>}
            />
          )}
          {activeTable === 'CALENDAR' && (
            <CatalogTable<HrLeaveCalendarEntry>
              className="hr-aus-table"
              ariaLabel={`Ausencias aprobadas entre ${dateLabel(dateFrom)} y ${dateLabel(dateTo)}`}
              rows={pageSlice(calendar)}
              rowKey={(entry) => entry.id}
              columns={calendarColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay ausencias aprobadas</strong><span>Amplía el rango de fechas o revisa las solicitudes pendientes.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('REQUESTS')}>Ver solicitudes</Button></div>}
            />
          )}
          {activeTable === 'BALANCES' && (
            <CatalogTable<HrVacationBalance>
              className="hr-aus-table"
              ariaLabel="Saldos disponibles por empleado"
              rows={pageSlice(balances)}
              rowKey={(balance) => balance.id}
              columns={balanceColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay saldos configurados</strong><span>Registra un ajuste inicial para comenzar el control.</span><Button size="sm" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button></div>}
            />
          )}
          {activeTable === 'TYPES' && (
            <CatalogTable<HrLeaveType>
              className="hr-aus-table"
              ariaLabel="Tipos de ausencia disponibles"
              rows={pageSlice(leaveTypes)}
              rowKey={(type) => type.id}
              columns={typeColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay tipos de ausencia</strong><span>Crea vacaciones, permisos, subsidios u otras políticas.</span><Button size="sm" onClick={() => openType()} disabled={!online}><Plus size={15} /> Crear tipo</Button></div>}
            />
          )}
          {activeTable === 'HISTORY' && (
            <CatalogTable<HrVacationLedgerEntry>
              className="hr-aus-table"
              ariaLabel="Movimientos de saldos"
              rows={pageSlice(ledger)}
              rowKey={(entry) => entry.id}
              columns={ledgerColumns}
              pagination={tablePagination}
              emptyLabel="Sin registros"
              emptyState={<div className="hr-admin-empty"><strong>No hay movimientos</strong><span>Los devengos, usos y ajustes aparecerán aquí.</span><Button size="sm" variant="ghost" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button></div>}
            />
          )}
        </HrTablePanel>
      )}
      <Sidebar
        isOpen={Boolean(panel)}
        onClose={() => !saving && setPanel(null)}
        title={
          panel === 'request'
            ? 'Nueva solicitud'
            : panel === 'type'
              ? 'Tipo de ausencia'
              : 'Ajuste de vacaciones'
        }
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
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
                <Button type="submit" disabled={!online || saving}>
                  {saving ? 'Guardando…' : 'Guardar tipo'}
                </Button>
              </>
            }
          >
            <label>
              Código
              <input
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
              <input
                value={typeForm.name}
                onChange={(event) =>
                  setTypeForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Unidad
              <HrReactSelect
                value={typeForm.unit}
                onChange={(event) =>
                  setTypeForm((current) => ({
                    ...current,
                    unit: event.target.value as HrBalanceUnit,
                  }))
                }
              >
                <option value="DAYS">Días</option>
                <option value="HOURS">Horas</option>
                <option value="MINUTES">Minutos</option>
              </HrReactSelect>
            </label>
            <label className="span-full">
              Descripción
              <textarea
                rows={3}
                value={typeForm.description}
                onChange={(event) =>
                  setTypeForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <div className="hr-checkbox-grid span-full">
              <label>
                <input
                  type="checkbox"
                  checked={typeForm.paid}
                  onChange={(event) =>
                    setTypeForm((current) => ({ ...current, paid: event.target.checked }))
                  }
                />{' '}
                Remunerada
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={typeForm.balanceTracked}
                  onChange={(event) =>
                    setTypeForm((current) => ({
                      ...current,
                      balanceTracked: event.target.checked,
                    }))
                  }
                />{' '}
                Controla saldo
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={typeForm.requiresAttachment}
                  onChange={(event) =>
                    setTypeForm((current) => ({
                      ...current,
                      requiresAttachment: event.target.checked,
                    }))
                  }
                />{' '}
                Requiere soporte
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={typeForm.active}
                  onChange={(event) =>
                    setTypeForm((current) => ({ ...current, active: event.target.checked }))
                  }
                />{' '}
                Activo
              </label>
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
                <Button
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
              <HrReactSelect
                value={adjustment.userId}
                onChange={(event) =>
                  setAdjustment((current) => ({
                    ...current,
                    userId: event.target.value,
                    balanceId: '',
                  }))
                }
                required
              >
                <option value="">Seleccionar…</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </HrReactSelect>
            </label>
            <label>
              Saldo objetivo
              <HrReactSelect
                value={adjustment.balanceId}
                onChange={(event) => {
                  const balance = balances.find((item) => String(item.id) === event.target.value);
                  setAdjustment((current) => ({
                    ...current,
                    balanceId: event.target.value,
                    unit: balance?.unit ?? current.unit,
                  }));
                }}
              >
                <option value="">Resolver en servidor</option>
                {balances
                  .filter((balance) => String(balance.userId) === adjustment.userId)
                  .map((balance) => (
                    <option key={balance.id} value={balance.id}>
                      {balance.periodLabel ?? `Saldo #${balance.id}`} · {balance.unit}
                    </option>
                  ))}
              </HrReactSelect>
            </label>
            <label>
              Fecha efectiva
              <input
                type="date"
                value={adjustment.effectiveDate}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, effectiveDate: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Cantidad con signo
              <input
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
              <HrReactSelect
                value={adjustment.unit}
                onChange={(event) =>
                  setAdjustment((current) => ({
                    ...current,
                    unit: event.target.value as HrBalanceUnit,
                  }))
                }
              >
                <option value="DAYS">Días</option>
                <option value="HOURS">Horas</option>
                <option value="MINUTES">Minutos</option>
              </HrReactSelect>
            </label>
            <label>
              Referencia
              <input
                value={adjustment.reference}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, reference: event.target.value }))
                }
              />
            </label>
            <label className="span-full">
              Razón obligatoria
              <textarea
                rows={4}
                maxLength={700}
                value={adjustment.reason}
                onChange={(event) =>
                  setAdjustment((current) => ({ ...current, reason: event.target.value }))
                }
                required
              />
            </label>
            <div className="hr-sensitive-warning span-full">
              <AlertTriangle size={18} />
              <span>
                El ajuste crea un movimiento de ledger; no edita ni recalcula el saldo en el
                navegador.
              </span>
            </div>
          </HrModalFormShell>
        )}
      </Sidebar>

      <Sidebar
        isOpen={Boolean(requestAction)}
        onClose={() => !saving && setRequestAction(null)}
        title={requestAction?.kind === 'cancel' ? 'Cancelar solicitud' : 'Decidir solicitud'}
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
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
              <Button type="submit" disabled={!online || saving || !actionReason.trim()}>{saving ? 'Registrando…' : 'Confirmar'}</Button>
            </>
          }
        >
          {requestAction?.kind === 'decide' && (
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
          <label className="span-full">
            Razón obligatoria
            <textarea
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
      </Sidebar>
    </HrPage>
  );
}
