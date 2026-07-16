import HrReactSelect from '../../components/hr/HrReactSelect';
import { formatHrNumber } from '../../utils/hrFormat';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ListChecks,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
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
import './workforce.css';
import './admin-tables.css';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters = { dateFrom, dateTo, userId: userId ? Number(userId) : undefined, limit: 100 };
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
        workforceClient.getLeaveRequests(filters),
        workforceClient.getLeaveCalendar(filters),
        workforceClient.getVacationBalances(filters),
        workforceClient.getVacationLedger(filters),
      ]);
      setLookups(organization);
      setLeaveTypes(typesResult);
      setRequests(requestResult.items);
      setCalendar(calendarResult);
      setBalances(balanceResult);
      setLedger(ledgerResult.items);
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

  return (
    <div className="page-wrapper hr-workforce-page">
      <PageHeader
        title="Permisos y vacaciones"
        subtitle="Aprueba solicitudes, consulta ausencias del equipo y controla los días disponibles"
        icon={CalendarDays}
        actions={
          <div className="hr-header-actions">
            <Button variant="secondary" onClick={() => openType()} disabled={!online}>
              <SlidersHorizontal size={17} /> Tipo
            </Button>
            <Button onClick={() => setPanel('request')} disabled={!online}>
              <Plus size={17} /> Solicitud
            </Button>
          </div>
        }
      />
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

      {loading && <LoadingSpinner text="Cargando permisos y vacaciones…" />}
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
        <section className="hr-admin-board" aria-label="Administración de permisos y vacaciones">
          <div className="hr-admin-tabs" role="tablist" aria-label="Bandejas de permisos y vacaciones">
            {([
              ['REQUESTS', 'Solicitudes', requests.filter((item) => item.status === 'PENDING').length],
              ['CALENDAR', 'Calendario', calendar.length],
              ['BALANCES', 'Saldos', balances.length],
              ['TYPES', 'Tipos de ausencia', leaveTypes.length],
              ['HISTORY', 'Movimientos', ledger.length],
            ] as Array<[LeaveTable, string, number]>).map(([value, label, count]) => (
              <button key={value} type="button" role="tab" aria-selected={activeTable === value} onClick={() => setActiveTable(value)}>{label} <span>{count}</span></button>
            ))}
          </div>

          <div className="hr-admin-table-wrap">
            {activeTable === 'REQUESTS' && (
              <table className="hr-admin-table">
                <caption>Solicitudes de permisos y vacaciones</caption>
                <thead><tr><th>Empleado</th><th>Tipo</th><th>Fechas</th><th>Duración</th><th>Motivo</th><th>Estado</th><th className="hr-admin-actions-col">Acciones</th></tr></thead>
                <tbody>{requests.length === 0 ? <tr><td colSpan={7}><div className="hr-admin-empty"><strong>No hay solicitudes en este periodo</strong><span>Puedes registrar una solicitud en nombre de un empleado.</span><Button size="sm" onClick={() => setPanel('request')} disabled={!online}><Plus size={15} /> Nueva solicitud</Button></div></td></tr> : requests.map((item) => <tr key={item.id} className={focusedRequestId === item.id ? 'is-selected' : ''}><td><strong>{item.user?.name ?? `Usuario #${item.userId}`}</strong></td><td>{item.leaveType?.name ?? `Tipo #${item.leaveTypeId}`}</td><td>{dateLabel(item.startDate)}<small>{item.endDate !== item.startDate ? `hasta ${dateLabel(item.endDate)}` : 'Un día'}</small></td><td>{fractionLabel(item.fraction)}{item.requestedAmount != null && <small>{formatHrNumber(item.requestedAmount)} {item.balanceUnit ?? ''}</small>}</td><td>{item.reason}</td><td><WorkforceStatusPill status={item.status} /></td><td className="hr-admin-actions-col"><div className="hr-admin-row-actions">{item.status === 'DRAFT' && <Button size="sm" onClick={() => void submitDraft(item)} disabled={!online || saving}>Enviar</Button>}{item.status === 'PENDING' && <Button size="sm" onClick={() => openRequestAction(item, 'decide')} disabled={!online}>Revisar</Button>}{(item.status === 'DRAFT' || item.status === 'PENDING') && <Button size="sm" variant="ghost" onClick={() => openRequestAction(item, 'cancel')} disabled={!online}>Cancelar</Button>}{!['DRAFT', 'PENDING'].includes(item.status) && <span className="hr-admin-muted">Finalizada</span>}</div></td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'CALENDAR' && (
              <table className="hr-admin-table">
                <caption>Ausencias aprobadas entre {dateLabel(dateFrom)} y {dateLabel(dateTo)}</caption>
                <thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th>Duración</th><th>Sucursal</th><th>Estado</th><th className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{calendar.length === 0 ? <tr><td colSpan={7}><div className="hr-admin-empty"><strong>No hay ausencias aprobadas</strong><span>Amplía el rango de fechas o revisa las solicitudes pendientes.</span><Button size="sm" variant="ghost" onClick={() => setActiveTable('REQUESTS')}>Ver solicitudes</Button></div></td></tr> : calendar.map((entry) => <tr key={entry.id}><td><strong>{dateLabel(entry.date)}</strong></td><td>{entry.user?.name ?? `Usuario #${entry.userId}`}</td><td>{entry.leaveType?.name ?? `Tipo #${entry.leaveTypeId}`}</td><td>{fractionLabel(entry.fraction)}</td><td>{entry.branch?.name ?? 'Sin sucursal'}</td><td><WorkforceStatusPill status={entry.status} /></td><td className="hr-admin-actions-col"><Button size="sm" variant="ghost" onClick={() => { setFocusedRequestId(entry.leaveRequestId); setActiveTable('REQUESTS'); }}>Ver solicitud</Button></td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'BALANCES' && (
              <table className="hr-admin-table">
                <caption>Saldos disponibles por empleado</caption>
                <thead><tr><th>Empleado</th><th>Tipo</th><th>Periodo</th><th>Devengado</th><th>Usado</th><th>Pendiente</th><th>Disponible</th><th>Actualizado</th><th className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{balances.length === 0 ? <tr><td colSpan={9}><div className="hr-admin-empty"><strong>No hay saldos configurados</strong><span>Registra un ajuste inicial para comenzar el control.</span><Button size="sm" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button></div></td></tr> : balances.map((balance) => <tr key={balance.id}><td><strong>{balance.user?.name ?? `Usuario #${balance.userId}`}</strong></td><td>{balance.leaveType?.name ?? 'Vacaciones'}</td><td>{balance.periodLabel ?? 'Vigente'}</td><td>{formatHrNumber(balance.accrued)} {balance.unit}</td><td>{formatHrNumber(balance.used)} {balance.unit}</td><td>{formatHrNumber(balance.pending)} {balance.unit}</td><td><strong>{formatHrNumber(balance.available)} {balance.unit}</strong></td><td>{dateLabel(balance.asOf)}</td><td className="hr-admin-actions-col"><Button size="sm" variant="secondary" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(balance.userId), balanceId: String(balance.id), unit: balance.unit })); setPanel('adjustment'); }} disabled={!online}>Ajustar</Button></td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'TYPES' && (
              <table className="hr-admin-table">
                <caption>Tipos de ausencia disponibles</caption>
                <thead><tr><th>Nombre</th><th>Código</th><th>Pago</th><th>Control de saldo</th><th>Unidad</th><th>Adjunto</th><th>Estado</th><th className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{leaveTypes.length === 0 ? <tr><td colSpan={8}><div className="hr-admin-empty"><strong>No hay tipos de ausencia</strong><span>Crea vacaciones, permisos, subsidios u otras políticas.</span><Button size="sm" onClick={() => openType()} disabled={!online}><Plus size={15} /> Crear tipo</Button></div></td></tr> : leaveTypes.map((type) => <tr key={type.id}><td><strong>{type.name}</strong><small>{type.description || 'Sin descripción'}</small></td><td><code>{type.code}</code></td><td>{type.paid ? 'Remunerado' : 'No remunerado'}</td><td>{type.balanceTracked ? 'Sí, descuenta saldo' : 'No'}</td><td>{type.unit}</td><td>{type.requiresAttachment ? 'Obligatorio' : 'Opcional'}</td><td><WorkforceStatusPill status={type.active ? 'ACTIVE' : 'INACTIVE'} /></td><td className="hr-admin-actions-col"><Button size="sm" variant="secondary" onClick={() => openType(type)} disabled={!online}>Editar</Button></td></tr>)}</tbody>
              </table>
            )}

            {activeTable === 'HISTORY' && (
              <table className="hr-admin-table">
                <caption>Movimientos de saldos</caption>
                <thead><tr><th>Fecha</th><th>Empleado</th><th>Movimiento</th><th>Cantidad</th><th>Motivo</th><th>Referencia</th><th>Saldo resultante</th><th className="hr-admin-actions-col">Acción</th></tr></thead>
                <tbody>{ledger.length === 0 ? <tr><td colSpan={8}><div className="hr-admin-empty"><strong>No hay movimientos</strong><span>Los devengos, usos y ajustes aparecerán aquí.</span><Button size="sm" variant="ghost" onClick={() => setPanel('adjustment')} disabled={!online}>Registrar ajuste</Button></div></td></tr> : ledger.map((entry) => <tr key={entry.id}><td>{dateLabel(entry.effectiveDate)}</td><td>{users.find((user) => user.id === entry.userId)?.name ?? `Usuario #${entry.userId}`}</td><td>{entry.type}</td><td>{formatHrNumber(entry.amount)} {entry.unit}</td><td>{entry.reason}</td><td>{entry.reference ?? `Movimiento #${entry.id}`}</td><td>{entry.resultingBalance != null ? `${formatHrNumber(entry.resultingBalance)} ${entry.unit}` : '—'}</td><td className="hr-admin-actions-col"><Button size="sm" variant="ghost" onClick={() => { setAdjustment((current) => ({ ...current, userId: String(entry.userId), balanceId: String(entry.balanceId), unit: entry.unit })); setPanel('adjustment'); }} disabled={!online}>Ajustar saldo</Button></td></tr>)}</tbody>
              </table>
            )}
          </div>
        </section>
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
        <form
          className="hr-workforce-form hr-sidebar-body"
          onSubmit={(event) => void saveRequestAction(event)}
        >
          <OnlineOnlyNotice online={online} compact />
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
          <div className="hr-form-actions span-full">
            <Button type="button" variant="ghost" onClick={() => setRequestAction(null)}>
              Volver
            </Button>
            <Button type="submit" disabled={!online || saving || !actionReason.trim()}>
              {saving ? 'Registrando…' : 'Confirmar'}
            </Button>
          </div>
        </form>
      </Sidebar>
    </div>
  );
}
