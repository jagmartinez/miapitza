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
  WalletCards,
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

type Panel = 'request' | 'type' | 'adjustment' | null;
type RequestAction = { item: HrLeaveRequest; kind: 'decide' | 'cancel' } | null;

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
        subtitle="Tipos, solicitudes, calendario y saldos con ledger"
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
        <>
          <div className="hr-workforce-columns">
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>
                    <ListChecks size={20} /> Solicitudes
                  </h2>
                  <p>
                    Crear deja DRAFT; enviar deja PENDING; aprobar o rechazar requiere acción
                    distinta.
                  </p>
                </div>
              </div>
              {requests.length === 0 ? (
                <p className="hr-empty">Sin solicitudes.</p>
              ) : (
                <div className="hr-record-list">
                  {requests.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {item.user?.name ?? `Usuario #${item.userId}`} ·{' '}
                          {item.leaveType?.name ?? `Tipo #${item.leaveTypeId}`}
                        </strong>
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
                            onClick={() => void submitDraft(item)}
                            disabled={!online || saving}
                          >
                            Enviar
                          </Button>
                        )}
                        {item.status === 'PENDING' && (
                          <Button
                            size="sm"
                            onClick={() => openRequestAction(item, 'decide')}
                            disabled={!online}
                          >
                            Decidir
                          </Button>
                        )}
                        {(item.status === 'DRAFT' || item.status === 'PENDING') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openRequestAction(item, 'cancel')}
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
                  <h2>
                    <CalendarDays size={20} /> Calendario aprobado
                  </h2>
                  <p>Fechas materializadas por el servidor para cobertura operativa.</p>
                </div>
              </div>
              {calendar.length === 0 ? (
                <p className="hr-empty">Sin ausencias en el rango.</p>
              ) : (
                <div className="hr-calendar-list">
                  {calendar.map((entry) => (
                    <article key={entry.id}>
                      <time dateTime={entry.date}>{entry.date}</time>
                      <div>
                        <strong>{entry.user?.name ?? `Usuario #${entry.userId}`}</strong>
                        <span>
                          {entry.leaveType?.name ?? `Tipo #${entry.leaveTypeId}`} · {entry.fraction}
                        </span>
                      </div>
                      <WorkforceStatusPill status={entry.status} />
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="hr-workforce-section">
            <div className="hr-section-heading">
              <div>
                <h2>Tipos de ausencia</h2>
                <p>
                  Configuración de catálogo; la política del servidor determina consumo y
                  elegibilidad.
                </p>
              </div>
            </div>
            <div className="hr-type-grid">
              {leaveTypes.map((type) => (
                <article key={type.id}>
                  <div>
                    <strong>{type.name}</strong>
                    <code>{type.code}</code>
                  </div>
                  <span>
                    {type.paid ? 'Remunerada' : 'No remunerada'} · {type.unit} ·{' '}
                    {type.balanceTracked ? 'controla saldo' : 'sin saldo'}
                  </span>
                  <div>
                    <WorkforceStatusPill status={type.active ? 'ACTIVE' : 'INACTIVE'} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openType(type)}
                      disabled={!online}
                    >
                      Editar
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="hr-workforce-columns">
            <section className="hr-workforce-section">
              <div className="hr-section-heading">
                <div>
                  <h2>
                    <WalletCards size={20} /> Saldos
                  </h2>
                  <p>Valores autoritativos, sin recálculo en navegador.</p>
                </div>
                <Button size="sm" onClick={() => setPanel('adjustment')} disabled={!online}>
                  Ajustar
                </Button>
              </div>
              {balances.length === 0 ? (
                <p className="hr-empty">Sin saldos.</p>
              ) : (
                <div className="hr-balance-grid">
                  {balances.map((balance) => (
                    <article key={balance.id}>
                      <strong>{balance.user?.name ?? `Usuario #${balance.userId}`}</strong>
                      <span>
                        Disponible: {formatHrNumber(balance.available)} {balance.unit}
                      </span>
                      <small>
                        Devengado {formatHrNumber(balance.accrued)} · usado{' '}
                        {formatHrNumber(balance.used)} · pendiente {formatHrNumber(balance.pending)}
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
                  <h2>Ledger de vacaciones</h2>
                  <p>Movimientos inmutables y saldo resultante emitido por servidor.</p>
                </div>
              </div>
              {ledger.length === 0 ? (
                <p className="hr-empty">Sin movimientos.</p>
              ) : (
                <div className="hr-record-list">
                  {ledger.map((entry) => (
                    <article key={entry.id}>
                      <div>
                        <strong>
                          {entry.type} · {formatHrNumber(entry.amount)} {entry.unit}
                        </strong>
                        <span>{entry.reason}</span>
                        <small>
                          {entry.effectiveDate} · {entry.reference ?? `Movimiento #${entry.id}`}
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
