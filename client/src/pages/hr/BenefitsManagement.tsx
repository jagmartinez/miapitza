import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatHrMoney } from '../../utils/hrDisplay';
import { Eye, Plus, RefreshCw, Search } from 'lucide-react';
import {
  AppSelect, Button, DataTable, EmptyState, FormSection, FullScreenModal, IconButton, Input, LoadErrorState, PageContent, PageHeader, StatCard,
  TableToolbar, Tabs,
} from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import BenefitsOnlineNotice from '../../components/hr/BenefitsOnlineNotice';
import BenefitsStatusPill from '../../components/hr/BenefitsStatusPill';
import BenefitsTransitionForm from '../../components/hr/BenefitsTransitionForm';
import { collectAllPages } from '../../components/hr/collectAllPages';
import BenefitsGovernance from './BenefitsGovernance';
import DeductionForm from '../../components/hr/DeductionForm';
import LoanRequestForm from '../../components/hr/LoanRequestForm';
import TravelExpenseForm from '../../components/hr/TravelExpenseForm';
import TravelRequestForm from '../../components/hr/TravelRequestForm';
import {
  benefitsClient,
  createBenefitsIdempotencyKey,
  getBenefitsErrorMessage,
} from '../../components/hr/benefitsClient';
import { hrClient } from '../../components/hr/hrClient';
import useBenefitsOnline from '../../components/hr/useBenefitsOnline';
import { useAppToast } from '../../context/ToastContext';
import type { HrOrganizationCatalogs } from '../../types/hr';
import type {
  HrBenefitsActionInput,
  HrBenefitsTransitionPayload,
  HrDeduction,
  HrDeductionAction,
  HrDeductionPayload,
  HrLoan,
  HrLoanAction,
  HrLoanRequestPayload,
  HrTravelAction,
  HrTravelExpensePayload,
  HrTravelRequest,
  HrTravelRequestPayload,
} from '../../types/hr-benefits';
import form from '../../components/hr/hrForm.module.css';

type OperationalTab = 'TRAVEL' | 'LOAN' | 'DEDUCTION';
type Tab = OperationalTab | 'GOVERNANCE';
const STATUS_OPTIONS: Record<OperationalTab, Array<{ value: string; label: string }>> = {
  TRAVEL: [
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'SUBMITTED', label: 'Enviado' },
    { value: 'APPROVED', label: 'Aprobado' },
    { value: 'ADVANCED', label: 'Anticipo entregado' },
    { value: 'IN_SETTLEMENT', label: 'En liquidación' },
    { value: 'SETTLED', label: 'Liquidado' },
    { value: 'REJECTED', label: 'Denegado' },
    { value: 'CANCELLED', label: 'Cancelado' },
  ],
  LOAN: [
    { value: 'REQUESTED', label: 'Solicitado' },
    { value: 'APPROVED', label: 'Aprobado' },
    { value: 'DISBURSED', label: 'Desembolsado' },
    { value: 'ACTIVE', label: 'Activo' },
    { value: 'PAID', label: 'Pagado' },
    { value: 'CLOSED', label: 'Cerrado' },
    { value: 'REJECTED', label: 'Denegado' },
    { value: 'CANCELLED', label: 'Cancelado' },
  ],
  DEDUCTION: [
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'ACTIVE', label: 'Activa' },
    { value: 'PAUSED', label: 'Pausada' },
    { value: 'COMPLETED', label: 'Completada' },
    { value: 'CANCELLED', label: 'Cancelada' },
  ],
};
type Selected =
  | { resource: 'TRAVEL'; item: HrTravelRequest }
  | { resource: 'LOAN'; item: HrLoan }
  | { resource: 'DEDUCTION'; item: HrDeduction };
type Transition =
  | { resource: 'TRAVEL'; item: HrTravelRequest; action: HrTravelAction }
  | { resource: 'LOAN'; item: HrLoan; action: HrLoanAction }
  | { resource: 'DEDUCTION'; item: HrDeduction; action: HrDeductionAction };
type CreatePanel = 'TRAVEL' | 'LOAN' | 'DEDUCTION' | 'EXPENSE' | null;

const EMPTY_ORGANIZATION: HrOrganizationCatalogs = {
  departments: [],
  positions: [],
  costCenters: [],
  branches: [],
  users: [],
};

const TRAVEL_ACTION_LABELS: Record<HrTravelAction, string> = {
  SUBMIT: 'Enviar',
  APPROVE: 'Aprobar',
  REJECT: 'Rechazar',
  REGISTER_ADVANCE: 'Anticipo',
  START_SETTLEMENT: 'Liquidar',
  SETTLE: 'Cerrar liquidación',
  CANCEL: 'Cancelar',
  REVERSE: 'Revertir',
};
const LOAN_ACTION_LABELS: Record<HrLoanAction, string> = {
  APPROVE: 'Aprobar',
  REJECT: 'Rechazar',
  DISBURSE: 'Desembolsar',
  REGISTER_PAYMENT: 'Abono',
  CLOSE: 'Cerrar',
  CANCEL: 'Cancelar',
  REVERSE: 'Revertir',
};
const DEDUCTION_ACTION_LABELS: Record<HrDeductionAction, string> = {
  ACTIVATE: 'Activar',
  PAUSE: 'Pausar',
  RESUME: 'Reanudar',
  CANCEL: 'Cancelar',
  REVERSE: 'Revertir',
};

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(parsed);
}

function money(currency: string, amount?: string | null): string {
  return formatHrMoney(currency, amount);
}

/** Totals already-loaded amounts per currency (no server call, display only). */
function sumByCurrency(rows: Array<{ currency: string; amount?: string | null }>): string {
  const totals = new Map<string, number>();
  rows.forEach(({ currency, amount }) => {
    const numeric = Number(amount ?? 0);
    const key = currency?.trim().toUpperCase() || 'NIO';
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(numeric) ? numeric : 0));
  });
  if (totals.size === 0) return money('NIO', '0');
  return [...totals.entries()].map(([currency, total]) => money(currency, total.toFixed(2))).join(' · ');
}

export default function BenefitsManagement() {
  const online = useBenefitsOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [tab, setTab] = useState<Tab>('TRAVEL');
  const [organization, setOrganization] = useState<HrOrganizationCatalogs>(EMPTY_ORGANIZATION);
  const [travel, setTravel] = useState<HrTravelRequest[]>([]);
  const [loans, setLoans] = useState<HrLoan[]>([]);
  const [deductions, setDeductions] = useState<HrDeduction[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanel>(null);
  const expenseOperationKey = useRef<string | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { status: status || undefined, limit: 100 };
      const [org, travelItems, loanItems, deductionItems] = await Promise.all([
        hrClient.getOrganization(),
        collectAllPages((page) => benefitsClient.getTravelRequests({ ...filters, page })),
        collectAllPages((page) => benefitsClient.getLoans({ ...filters, page })),
        collectAllPages((page) => benefitsClient.getDeductions({ ...filters, page })),
      ]);
      setOrganization(org);
      setTravel(travelItems);
      setLoans(loanItems);
      setDeductions(deductionItems);
    } catch (loadError) {
      setTravel([]);
      setLoans([]);
      setDeductions([]);
      setError(
        getBenefitsErrorMessage(
          loadError,
          'No fue posible cargar viáticos, préstamos y deducciones.'
        )
      );
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);


  const openDetail = async (selection: Selected) => {
    setDetailLoading(true);
    try {
      if (selection.resource === 'TRAVEL')
        setSelected({
          resource: 'TRAVEL',
          item: await benefitsClient.getTravelRequest(selection.item.id),
        });
      else if (selection.resource === 'LOAN')
        setSelected({ resource: 'LOAN', item: await benefitsClient.getLoan(selection.item.id) });
      else
        setSelected({
          resource: 'DEDUCTION',
          item: await benefitsClient.getDeduction(selection.item.id),
        });
    } catch (detailError) {
      showError(
        getBenefitsErrorMessage(detailError, 'No fue posible abrir el detalle financiero.')
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshSelected = async (selection: Selected) => {
    await load();
    await openDetail(selection);
  };

  const saveTravel = async (payload: HrTravelRequestPayload) => {
    setSaving(true);
    try {
      const created = await benefitsClient.createTravelRequest(
        payload,
        createBenefitsIdempotencyKey()
      );
      showSuccess('Viático creado como borrador.');
      setCreatePanel(null);
      await refreshSelected({ resource: 'TRAVEL', item: created });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible crear el viático.'));
    } finally {
      setSaving(false);
    }
  };

  const saveLoan = async (payload: HrLoanRequestPayload) => {
    setSaving(true);
    try {
      const created = await benefitsClient.createLoanRequest(
        payload,
        createBenefitsIdempotencyKey()
      );
      showSuccess('Solicitud de préstamo registrada.');
      setCreatePanel(null);
      await refreshSelected({ resource: 'LOAN', item: created });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible registrar el préstamo.'));
    } finally {
      setSaving(false);
    }
  };

  const saveDeduction = async (payload: HrDeductionPayload) => {
    setSaving(true);
    try {
      const created = await benefitsClient.createDeduction(payload, createBenefitsIdempotencyKey());
      showSuccess('Deducción creada como borrador.');
      setCreatePanel(null);
      await refreshSelected({ resource: 'DEDUCTION', item: created });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible crear la deducción.'));
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async (payload: HrTravelExpensePayload) => {
    if (selected?.resource !== 'TRAVEL') return;
    const idempotencyKey = expenseOperationKey.current ?? createBenefitsIdempotencyKey();
    expenseOperationKey.current = idempotencyKey;
    setSaving(true);
    try {
      await benefitsClient.addTravelExpense(selected.item.id, payload, idempotencyKey);
      showSuccess('Gasto registrado para conciliación.');
      expenseOperationKey.current = null;
      setCreatePanel(null);
      await refreshSelected(selected);
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible registrar el gasto.'));
    } finally {
      setSaving(false);
    }
  };

  const applyTransition = async (input: HrBenefitsActionInput) => {
    if (!transition) return;
    setSaving(true);
    const base: HrBenefitsTransitionPayload = {
      reason: input.reason,
      confirmed: true,
      expectedRevision: input.expectedRevision,
      effectiveDate: input.effectiveDate,
      reference: input.operationReference,
    };
    try {
      let refreshed: Selected;
      if (transition.resource === 'TRAVEL') {
        const payload =
          transition.action === 'APPROVE'
            ? { ...base, approvedAmount: input.proposedAmount }
            : transition.action === 'REGISTER_ADVANCE'
              ? { ...base, advanceReference: input.operationReference ?? '' }
              : transition.action === 'SETTLE'
                ? { ...base, settlementReference: input.operationReference }
                : base;
        const item = await benefitsClient.transitionTravel(
          transition.item.id,
          transition.action,
          payload,
          createBenefitsIdempotencyKey()
        );
        refreshed = { resource: 'TRAVEL', item };
      } else if (transition.resource === 'LOAN') {
        const payload =
          transition.action === 'APPROVE'
            ? {
                ...base,
                approvedAmount: input.proposedAmount,
                installmentCount: input.installmentCount,
                firstDueDate: input.firstDueDate,
              }
            : transition.action === 'DISBURSE'
              ? { ...base, disbursementReference: input.operationReference ?? '' }
              : transition.action === 'REGISTER_PAYMENT'
                ? {
                    ...base,
                    paymentReference: input.operationReference ?? '',
                    receivedAmount: input.proposedAmount ?? '',
                  }
                : base;
        const item = await benefitsClient.transitionLoan(
          transition.item.id,
          transition.action,
          payload,
          createBenefitsIdempotencyKey()
        );
        refreshed = { resource: 'LOAN', item };
      } else {
        const item = await benefitsClient.transitionDeduction(
          transition.item.id,
          transition.action,
          base,
          createBenefitsIdempotencyKey()
        );
        refreshed = { resource: 'DEDUCTION', item };
      }
      showSuccess('Transición registrada con trazabilidad.');
      setTransition(null);
      await refreshSelected(refreshed);
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible registrar la transición.'));
    } finally {
      setSaving(false);
    }
  };

  const cards = tab === 'TRAVEL' ? travel : tab === 'LOAN' ? loans : deductions;
  const filteredCards = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-NI');
    if (!term) return cards;
    return cards.filter((entry) => {
      const item = entry as HrTravelRequest | HrLoan | HrDeduction;
      const detail = tab === 'TRAVEL'
        ? `${(item as HrTravelRequest).destination} ${(item as HrTravelRequest).departureDate}`
        : tab === 'LOAN'
          ? (item as HrLoan).purpose
          : `${(item as HrDeduction).name} ${(item as HrDeduction).effectiveFrom}`;
      return `${item.code} ${item.user?.name ?? ''} ${detail}`.toLocaleLowerCase('es-NI').includes(term);
    });
  }, [cards, search, tab]);
  const internalUsers = (organization.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );
  const activePanelId = `benefits-panel-${tab.toLowerCase()}`;

  const selectTab = (next: Tab) => {
    setTab(next);
    setStatus('');
    setSelected(null);
  };
  const tabsBar = (
    <Tabs
      ariaLabel="Administración de beneficios"
      active={tab}
      onChange={(id) => selectTab(id as Tab)}
      tabs={[
        { id: 'TRAVEL', label: 'Viáticos', badge: travel.length },
        { id: 'LOAN', label: 'Préstamos', badge: loans.length },
        { id: 'DEDUCTION', label: 'Deducciones', badge: deductions.length },
        { id: 'GOVERNANCE', label: 'Liquidaciones y políticas' },
      ]}
    />
  );

  if (tab === 'GOVERNANCE') {
    return (
      <PageContent>
        <PageHeader
          breadcrumb={['Recursos humanos', 'Prestaciones']}
          title="Beneficios y liquidaciones"
          description="Opera viáticos, préstamos, deducciones, políticas y cierres laborales desde una sola vista."
        />
        {tabsBar}
        <section id={activePanelId} role="tabpanel" aria-label="Liquidaciones y políticas">
          <BenefitsGovernance embedded />
        </section>
      </PageContent>
    );
  }

  const travelInProgress = travel.filter((item) => ['SUBMITTED', 'APPROVED', 'ADVANCED', 'IN_SETTLEMENT'].includes(item.status));
  const openLoans = loans.filter((item) => ['DISBURSED', 'ACTIVE'].includes(item.status));
  const pendingActions = [...travel, ...loans, ...deductions].filter((item) => item.allowedActions.length > 0).length;
  const newLabel = tab === 'TRAVEL' ? 'Nuevo viático' : tab === 'LOAN' ? 'Nuevo préstamo' : 'Nueva deducción';
  const resourceLabel = (resource: OperationalTab) => (resource === 'TRAVEL' ? 'Viático' : resource === 'LOAN' ? 'Préstamo' : 'Deducción');

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Prestaciones']}
        title="Viáticos, préstamos y deducciones"
        description="Aprueba solicitudes, registra pagos y controla lo que se descontará en nómina"
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreatePanel(tab)} disabled={!online}>{newLabel}</Button>}
      />
      <BenefitsOnlineNotice online={online} />
      {(travelInProgress.length > 0 || openLoans.length > 0 || pendingActions > 0) && (
        <section className={form.kpis} aria-label="Indicadores de beneficios">
          {pendingActions > 0 && (
            <StatCard tone="danger" label="Por atender" value={String(pendingActions)} context="Registros con una acción disponible." />
          )}
          {travelInProgress.length > 0 && (
            <StatCard
              tone="warning"
              label="Viáticos en curso"
              value={String(travelInProgress.length)}
              context={sumByCurrency(travelInProgress.map((item) => ({ currency: item.currency, amount: item.approvedAmount ?? item.requestedAmount })))}
            />
          )}
          {openLoans.length > 0 && (
            <StatCard
              label="Saldo de préstamos"
              value={sumByCurrency(openLoans.map((item) => ({ currency: item.currency, amount: item.outstandingBalance })))}
              context={`${openLoans.length} préstamo${openLoans.length === 1 ? '' : 's'} vigente${openLoans.length === 1 ? '' : 's'}`}
            />
          )}
        </section>
      )}
      {tabsBar}
      {!loading && error ? (
        <LoadErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div id={activePanelId} role="tabpanel" aria-label={tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones'}>
          <DataTable
            ariaLabel={`${tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones'}: ${filteredCards.length} registros`}
            rows={filteredCards}
            rowKey={(entry) => `${tab}-${entry.id}`}
            loading={loading}
            pagination={{ mode: 'client' }}
            minWidth="56rem"
            onRowClick={(entry) => void openDetail({ resource: tab, item: entry } as Selected)}
            toolbar={(
              <TableToolbar actions={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading || !online}>Actualizar</Button>}>
                <Input
                  type="search"
                  aria-label="Buscar por código, empleado o detalle"
                  prefix={<Search size={14} aria-hidden="true" />}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Código, empleado o detalle"
                />
                <AppSelect<string>
                  options={[
                    { value: '', label: 'Todos los estados' },
                    ...STATUS_OPTIONS[tab].map((option) => ({
                      value: String(option.value),
                      label: option.label,
                    })),
                  ]}
                  value={status}
                  onChange={(next) => setStatus(next ?? '')}
                  aria-label="Filtrar por estado"
                  isClearable={false}
                />
              </TableToolbar>
            )}
            empty={(
              <EmptyState
                title={search ? 'No hay coincidencias' : 'No hay registros para este estado'}
                description={search ? 'Prueba otro código, empleado o detalle.' : 'Cambia el estado o crea un nuevo registro.'}
                action={(
                  <>
                    {search && <Button size="sm" variant="ghost" onClick={() => setSearch('')}>Limpiar búsqueda</Button>}
                    {status && <Button size="sm" variant="ghost" onClick={() => setStatus('')}>Mostrar todos</Button>}
                    <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreatePanel(tab)} disabled={!online}>{newLabel}</Button>
                  </>
                )}
              />
            )}
            columns={[
              { key: 'c0', header: 'Código', render: (entry) => { const item = entry as HrTravelRequest | HrLoan | HrDeduction; return <span className={form.cellTitle}>{item.code}</span>; } },
              { key: 'c1', header: 'Empleado', render: (entry) => { const item = entry as HrTravelRequest | HrLoan | HrDeduction; return <>{item.user?.name ?? `Usuario #${item.userId}`}</>; } },
              { key: 'c2', header: tab === 'TRAVEL'
                      ? 'Destino y fechas'
                      : tab === 'LOAN'
                        ? 'Motivo'
                        : 'Deducción y vigencia', render: (entry) => { const resource = tab; const item = entry as HrTravelRequest | HrLoan | HrDeduction; const description = resource === 'TRAVEL' ? `${(item as HrTravelRequest).destination} · ${dateLabel((item as HrTravelRequest).departureDate)} a ${dateLabel((item as HrTravelRequest).returnDate)}` : resource === 'LOAN' ? (item as HrLoan).purpose : `${(item as HrDeduction).name} · desde ${dateLabel((item as HrDeduction).effectiveFrom)}`; return <>{description}</>; } },
              { key: 'c3', header: tab === 'LOAN' ? 'Saldo' : 'Importe', type: 'money', render: (entry) => { const resource = tab; const item = entry as HrTravelRequest | HrLoan | HrDeduction; const amount = resource === 'TRAVEL' ? money( (item as HrTravelRequest).currency, (item as HrTravelRequest).approvedAmount ?? (item as HrTravelRequest).requestedAmount ) : resource === 'LOAN' ? money( (item as HrLoan).currency, (item as HrLoan).outstandingBalance ) : money( (item as HrDeduction).currency, (item as HrDeduction).applicableAmount ); return <span className={form.cellTitle}>{amount}</span>; } },
              { key: 'c4', header: 'Estado', render: (entry) => { const item = entry as HrTravelRequest | HrLoan | HrDeduction; return <BenefitsStatusPill status={item.status} />; } },
              { key: 'c5', header: 'Siguiente paso', render: (entry) => { const resource = tab; const item = entry as HrTravelRequest | HrLoan | HrDeduction; const nextAction = item.allowedActions[0]; const nextLabel = !nextAction ? 'Sin acciones pendientes' : resource === 'TRAVEL' ? TRAVEL_ACTION_LABELS[ nextAction as HrTravelRequest['allowedActions'][number] ] : resource === 'LOAN' ? LOAN_ACTION_LABELS[nextAction as HrLoan['allowedActions'][number]] : DEDUCTION_ACTION_LABELS[ nextAction as HrDeduction['allowedActions'][number] ]; return <>{nextLabel}</>; } },
              { key: 'c6', header: 'Acción', width: '6rem', type: 'actions', render: (entry) => { const resource = tab; const item = entry as HrTravelRequest | HrLoan | HrDeduction; return (
                <div className={form.rowActions}>
                  <IconButton icon={Eye} size="sm" label={`Ver y gestionar ${item.code}`} onClick={() => void openDetail({ resource, item } as Selected)} />
                </div>
              ); } },
            ]}
          />
        </div>
      )}

      <FullScreenModal
        isOpen={Boolean(selected) || detailLoading}
        onClose={() => setSelected(null)}
        breadcrumb={['Recursos humanos', 'Prestaciones']}
        title={selected ? `${resourceLabel(selected.resource)} ${selected.item.code}` : 'Detalle'}
        subtitle={selected ? (selected.item.user?.name ?? `Usuario #${selected.item.userId}`) : undefined}
        status={selected ? <BenefitsStatusPill status={selected.item.status} /> : undefined}
        footer={selected ? (
          <>
            {selected.resource === 'TRAVEL' && (
              <>
                {['ADVANCED', 'IN_SETTLEMENT'].includes(selected.item.status) && (
                  <Button
                    variant="ghost"
                    icon={Plus}
                    onClick={() => {
                      expenseOperationKey.current = createBenefitsIdempotencyKey();
                      setCreatePanel('EXPENSE');
                    }}
                    disabled={!online}
                  >
                    Gasto
                  </Button>
                )}
                {selected.item.allowedActions.map((action) => (
                  <Button
                    key={action}
                    variant={['REJECT', 'CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'}
                    onClick={() => setTransition({ resource: 'TRAVEL', item: selected.item, action })}
                    disabled={!online}
                  >
                    {TRAVEL_ACTION_LABELS[action]}
                  </Button>
                ))}
              </>
            )}
            {selected.resource === 'LOAN' &&
              selected.item.allowedActions.map((action) => (
                <Button
                  key={action}
                  variant={['REJECT', 'CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'}
                  onClick={() => setTransition({ resource: 'LOAN', item: selected.item, action })}
                  disabled={!online}
                >
                  {LOAN_ACTION_LABELS[action]}
                </Button>
              ))}
            {selected.resource === 'DEDUCTION' &&
              selected.item.allowedActions.map((action) => (
                <Button
                  key={action}
                  variant={['CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'}
                  onClick={() => setTransition({ resource: 'DEDUCTION', item: selected.item, action })}
                  disabled={!online}
                >
                  {DEDUCTION_ACTION_LABELS[action]}
                </Button>
              ))}
          </>
        ) : undefined}
      >
        {detailLoading ? (
          <HrLoading text="Abriendo detalle…" />
        ) : selected ? (
          <div className={form.form} aria-live="polite">
            <dl className={form.facts}>
              {selected.resource === 'TRAVEL' && (
                <>
                  <div><dt>Solicitado</dt><dd>{money(selected.item.currency, selected.item.requestedAmount)}</dd></div>
                  <div><dt>Anticipo</dt><dd>{money(selected.item.currency, selected.item.advanceAmount)}</dd></div>
                  <div><dt>Devolución</dt><dd>{money(selected.item.currency, selected.item.employeeReturnAmount)}</dd></div>
                  <div><dt>Reembolso</dt><dd>{money(selected.item.currency, selected.item.employeeReimbursementAmount)}</dd></div>
                </>
              )}
              {selected.resource === 'LOAN' && (
                <>
                  <div><dt>Solicitado</dt><dd>{money(selected.item.currency, selected.item.requestedAmount)}</dd></div>
                  <div><dt>Saldo</dt><dd>{money(selected.item.currency, selected.item.outstandingBalance)}</dd></div>
                  <div><dt>Cuotas</dt><dd>{selected.item.installmentCount}</dd></div>
                  <div><dt>Descuento nómina</dt><dd>{selected.item.payrollDeductionRequested ? 'Sí' : 'No'}</dd></div>
                </>
              )}
              {selected.resource === 'DEDUCTION' && (
                <>
                  <div><dt>Aplicable</dt><dd>{money(selected.item.currency, selected.item.applicableAmount)}</dd></div>
                  <div><dt>Remanente</dt><dd>{money(selected.item.currency, selected.item.remainingAmount)}</dd></div>
                  <div><dt>Prioridad</dt><dd>{selected.item.priority}</dd></div>
                  <div><dt>Vigencia</dt><dd>{dateLabel(selected.item.effectiveFrom)}</dd></div>
                </>
              )}
            </dl>
            {selected.resource === 'TRAVEL' && (
              <FormSection title="Gastos y soportes">
                <DataTable
                  ariaLabel="Gastos y soportes"
                  rows={(selected.item.expenses ?? [])}
                  rowKey={(expense) => expense.id}
                  pagination={{ mode: 'client' }}
                  minWidth="48rem"
                  empty={<EmptyState title="Sin gastos registrados" />}
                  columns={[
                    { key: 'c0', header: 'Fecha', render: (expense) => <>{dateLabel(expense.occurredOn)}</> },
                    { key: 'c1', header: 'Categoría', render: (expense) => <>{expense.category}</> },
                    { key: 'c2', header: 'Reclamado', type: 'money', render: (expense) => <>{money(expense.currency, expense.claimedAmount)}</> },
                    { key: 'c3', header: 'Reconocido', type: 'money', render: (expense) => <>{money(expense.currency, expense.recognizedAmount)}</> },
                    { key: 'c4', header: 'Soporte', render: (expense) => <>{expense.evidence?.fileName ?? expense.receiptReference ?? '—'}</> },
                    { key: 'c5', header: 'Estado', render: (expense) => <BenefitsStatusPill status={expense.status} /> },
                  ]}
                />
              </FormSection>
            )}
            {selected.resource === 'LOAN' && (
              <>
                <FormSection title="Calendario informativo del servidor">
                  <DataTable
                    ariaLabel="Calendario de cuotas"
                    rows={(selected.item.schedule ?? [])}
                    rowKey={(installment) => installment.id}
                    pagination={{ mode: 'client' }}
                    minWidth="48rem"
                    empty={<EmptyState title="Sin cuotas calculadas" />}
                    columns={[
                      { key: 'c0', header: '#', render: (installment) => <>{installment.number}</> },
                      { key: 'c1', header: 'Vence', render: (installment) => <>{dateLabel(installment.dueDate)}</> },
                      { key: 'c2', header: 'Programado', type: 'money', render: (installment) => <>{money(selected.item.currency, installment.scheduledTotal)}</> },
                      { key: 'c3', header: 'Pagado', type: 'money', render: (installment) => <>{money(selected.item.currency, installment.paidAmount)}</> },
                      { key: 'c4', header: 'Saldo cuota', type: 'money', render: (installment) => <>{money(selected.item.currency, installment.outstandingAmount)}</> },
                      { key: 'c5', header: 'Estado', render: (installment) => <BenefitsStatusPill status={installment.status} /> },
                    ]}
                  />
                </FormSection>
                <FormSection title="Ledger">
                  {(selected.item.ledger ?? []).length > 0 ? (
                    <ul className={form.list}>
                      {(selected.item.ledger ?? []).map((entry) => (
                        <li key={entry.id}>
                          <span className={form.cellStack}>
                            <span className={form.cellTitle}>{entry.type}</span>
                            <span className={form.cellSub}>{dateLabel(entry.effectiveDate)} · {entry.reference ?? entry.reason}</span>
                          </span>
                          <strong className="hr-money">{money(entry.currency, entry.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : <p className={form.help}>Sin movimientos.</p>}
                </FormSection>
              </>
            )}
            {selected.item.trace && selected.item.trace.length > 0 && (
              <FormSection title="Trazabilidad">
                <ul className={form.list}>
                  {selected.item.trace.map((event) => (
                    <li key={event.id}>
                      <span className={form.cellStack}>
                        <span className={form.cellTitle}>{event.event}</span>
                        <span className={form.cellSub}>
                          {dateLabel(event.occurredAt)} · {event.actor?.name ?? 'Sistema'} · {event.reason ?? 'Sin nota'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </FormSection>
            )}
          </div>
        ) : null}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(createPanel)}
        onClose={() => {
          if (!saving) {
            if (createPanel === 'EXPENSE') expenseOperationKey.current = null;
            setCreatePanel(null);
          }
        }}
        breadcrumb={['Recursos humanos', 'Prestaciones']}
        title={
          createPanel === 'TRAVEL'
            ? 'Nuevo viático'
            : createPanel === 'LOAN'
              ? 'Nueva solicitud de préstamo'
              : createPanel === 'DEDUCTION'
                ? 'Nueva deducción'
                : 'Registrar gasto'
        }
      >
        {createPanel === 'TRAVEL' && (
          <TravelRequestForm
            users={internalUsers}
            branches={organization.branches ?? []}
            online={online}
            saving={saving}
            onSubmit={saveTravel}
            onCancel={() => setCreatePanel(null)}
          />
        )}
        {createPanel === 'LOAN' && (
          <LoanRequestForm
            users={internalUsers}
            online={online}
            saving={saving}
            onSubmit={saveLoan}
            onCancel={() => setCreatePanel(null)}
          />
        )}
        {createPanel === 'DEDUCTION' && (
          <DeductionForm
            users={internalUsers}
            online={online}
            saving={saving}
            onSubmit={saveDeduction}
            onCancel={() => setCreatePanel(null)}
          />
        )}
        {createPanel === 'EXPENSE' && (
          <TravelExpenseForm
            online={online}
            saving={saving}
            onSubmit={saveExpense}
            onCancel={() => {
              expenseOperationKey.current = null;
              setCreatePanel(null);
            }}
          />
        )}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(transition)}
        onClose={() => !saving && setTransition(null)}
        title="Confirmar transición"
      >
        {transition && (
          <BenefitsTransitionForm
            code={transition.item.code}
            revision={transition.item.revision}
            action={transition.action}
            resource={transition.resource}
            online={online}
            saving={saving}
            onSubmit={applyTransition}
            onCancel={() => setTransition(null)}
          />
        )}
      </FullScreenModal>
    </PageContent>
  );
}
