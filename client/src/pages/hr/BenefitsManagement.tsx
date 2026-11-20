import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatHrMoney } from '../../utils/hrFormat';
import {
  AlertTriangle,
  Banknote,
  FileMinus2,
  Eye,
  WalletCards,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import Button from '../../components/Button';
import HrReactSelect from '../../components/hr/HrReactSelect';
import LoadingSpinner from '../../components/LoadingSpinner';
import CatalogTable, { type CatalogColumn } from '../../components/CatalogTable';
import Sidebar from '../../components/Sidebar';
import {
  HrHero,
  HrPage,
  HrSection,
  HrSplit,
  HrTablePanel,
  HrTabs,
  HrToolbar,
  type HrFact,
  type HrTabItem,
} from '../../components/hr/layout/HrWorkspace';
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
import './benefits.css';
import './admin-tables.css';
import '../Inventory.css';
import './layouts/prestaciones.css';

type OperationalTab = 'TRAVEL' | 'LOAN' | 'DEDUCTION';
type Tab = OperationalTab | 'GOVERNANCE';
const PAGE_SIZE = 12;
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
type BoardItem = HrTravelRequest | HrLoan | HrDeduction;
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
  const [tablePage, setTablePage] = useState(1);

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

  useEffect(() => {
    setTablePage(1);
  }, [status, tab]);

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
  const pagedCards = filteredCards.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);
  useEffect(() => {
    setTablePage((page) => Math.min(page, Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))));
  }, [filteredCards.length]);
  const internalUsers = (organization.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );
  const activePanelId = `benefits-panel-${tab.toLowerCase()}`;

  const tabLabel = tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones';
  const createLabel =
    tab === 'TRAVEL' ? 'Nuevo viático' : tab === 'LOAN' ? 'Nuevo préstamo' : 'Nueva deducción';
  const changeTab = (value: Tab) => {
    setTab(value);
    setStatus('');
    setSelected(null);
  };

  const travelInProgress = travel.filter((item) =>
    ['SUBMITTED', 'APPROVED', 'ADVANCED', 'IN_SETTLEMENT'].includes(item.status)
  );
  const openLoans = loans.filter((item) => ['DISBURSED', 'ACTIVE'].includes(item.status));
  const activeDeductions = deductions.filter((item) => item.status === 'ACTIVE');
  const pendingActions = [...travel, ...loans, ...deductions].filter(
    (item) => item.allowedActions.length > 0
  ).length;
  const facts: HrFact[] = [
    {
      label: 'Viáticos en curso',
      value: travelInProgress.length,
      hint: sumByCurrency(
        travelInProgress.map((item) => ({
          currency: item.currency,
          amount: item.approvedAmount ?? item.requestedAmount,
        }))
      ),
      tone: travelInProgress.length > 0 ? 'warning' : 'default',
    },
    {
      label: 'Saldo de préstamos',
      value: sumByCurrency(
        openLoans.map((item) => ({ currency: item.currency, amount: item.outstandingBalance }))
      ),
      hint: `${openLoans.length} préstamos vigentes`,
      tone: 'accent',
    },
    {
      label: 'Deducciones activas',
      value: activeDeductions.length,
      hint: sumByCurrency(
        activeDeductions.map((item) => ({ currency: item.currency, amount: item.applicableAmount }))
      ),
    },
    {
      label: 'Por atender',
      value: pendingActions,
      hint: status ? 'Según el estado filtrado' : 'Registros con acción disponible',
      tone: pendingActions > 0 ? 'danger' : 'success',
    },
  ];

  const tabItems: HrTabItem<Tab>[] = [
    { key: 'TRAVEL', label: 'Viáticos', count: travel.length, icon: Route },
    { key: 'LOAN', label: 'Préstamos', count: loans.length, icon: Banknote },
    { key: 'DEDUCTION', label: 'Deducciones', count: deductions.length, icon: FileMinus2 },
    { key: 'GOVERNANCE', label: 'Liquidaciones y políticas', icon: ShieldCheck },
  ];

  const hero = (
    <div className="inventory-header-new hr-operation-header bnx-hero-slot">
      <HrHero
        eyebrow="Recursos humanos"
        icon={WalletCards}
        title={tab === 'GOVERNANCE' ? 'Beneficios y liquidaciones' : 'Viáticos, préstamos y deducciones'}
        subtitle={
          tab === 'GOVERNANCE'
            ? 'Opera viáticos, préstamos, deducciones, políticas y cierres laborales desde una sola vista.'
            : 'Aprueba solicitudes, registra pagos y controla lo que se descontará en nómina'
        }
        actions={
          tab === 'GOVERNANCE' ? undefined : (
            <div className="hr-benefits-header-actions">
              <Button onClick={() => setCreatePanel(tab)} disabled={!online}>
                <Plus size={17} aria-hidden="true" /> {createLabel}
              </Button>
            </div>
          )
        }
        facts={loading || error ? undefined : facts}
      />
    </div>
  );

  const tabs = (
    <HrTabs<Tab>
      items={tabItems}
      active={tab}
      onChange={changeTab}
      ariaLabel={tab === 'GOVERNANCE' ? 'Administración de beneficios' : 'Beneficios financieros'}
      idPrefix="benefits"
    />
  );

  if (tab === 'GOVERNANCE') {
    return (
      <HrPage className="inventory-page hr-benefits-page hr-admin-catalog-page hr-operation-page prestaciones-page">
        {hero}
        {tabs}
        <section
          id={activePanelId}
          className="bnx-governance-panel"
          role="tabpanel"
          aria-label="Liquidaciones y políticas"
        >
          <BenefitsGovernance embedded />
        </section>
      </HrPage>
    );
  }

  const statusBreakdown = STATUS_OPTIONS[tab]
    .map((option) => ({
      ...option,
      count: (cards as Array<HrTravelRequest | HrLoan | HrDeduction>).filter(
        (item) => item.status === option.value
      ).length,
    }))
    .filter((option) => option.count > 0);

  const detailPanel =
    detailLoading || selected ? (
      <HrSection
        className="hr-benefits-workspace is-visible bnx-detail"
        eyebrow={
          selected
            ? selected.resource === 'TRAVEL'
              ? 'Viático'
              : selected.resource === 'LOAN'
                ? 'Préstamo'
                : 'Deducción'
            : undefined
        }
        title={selected && !detailLoading ? selected.item.code : undefined}
        description={
          selected && !detailLoading
            ? (selected.item.user?.name ?? `Usuario #${selected.item.userId}`)
            : undefined
        }
        actions={
          selected && !detailLoading ? (
            <div className="hr-benefits-workspace-controls">
              <BenefitsStatusPill status={selected.item.status} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(null)}
                aria-label="Cerrar detalle"
                title="Cerrar detalle"
              >
                <X size={16} />
              </Button>
            </div>
          ) : undefined
        }
      >
        <div aria-live="polite">
          {detailLoading ? (
            <LoadingSpinner text="Abriendo detalle…" />
          ) : selected ? (
            <>
              <dl className="bnx-metrics">
                {selected.resource === 'TRAVEL' && (
                  <>
                    <div>
                      <dt>Solicitado</dt>
                      <dd>{money(selected.item.currency, selected.item.requestedAmount)}</dd>
                    </div>
                    <div>
                      <dt>Anticipo</dt>
                      <dd>{money(selected.item.currency, selected.item.advanceAmount)}</dd>
                    </div>
                    <div>
                      <dt>Devolución</dt>
                      <dd>{money(selected.item.currency, selected.item.employeeReturnAmount)}</dd>
                    </div>
                    <div>
                      <dt>Reembolso</dt>
                      <dd>
                        {money(selected.item.currency, selected.item.employeeReimbursementAmount)}
                      </dd>
                    </div>
                  </>
                )}
                {selected.resource === 'LOAN' && (
                  <>
                    <div>
                      <dt>Solicitado</dt>
                      <dd>{money(selected.item.currency, selected.item.requestedAmount)}</dd>
                    </div>
                    <div>
                      <dt>Saldo</dt>
                      <dd>{money(selected.item.currency, selected.item.outstandingBalance)}</dd>
                    </div>
                    <div>
                      <dt>Cuotas</dt>
                      <dd>{selected.item.installmentCount}</dd>
                    </div>
                    <div>
                      <dt>Descuento nómina</dt>
                      <dd>{selected.item.payrollDeductionRequested ? 'Sí' : 'No'}</dd>
                    </div>
                  </>
                )}
                {selected.resource === 'DEDUCTION' && (
                  <>
                    <div>
                      <dt>Aplicable</dt>
                      <dd>{money(selected.item.currency, selected.item.applicableAmount)}</dd>
                    </div>
                    <div>
                      <dt>Remanente</dt>
                      <dd>{money(selected.item.currency, selected.item.remainingAmount)}</dd>
                    </div>
                    <div>
                      <dt>Prioridad</dt>
                      <dd>{selected.item.priority}</dd>
                    </div>
                    <div>
                      <dt>Vigencia</dt>
                      <dd>{dateLabel(selected.item.effectiveFrom)}</dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="bnx-actions" role="group" aria-label="Acciones disponibles">
                {selected.resource === 'TRAVEL' && (
                  <>
                    {selected.item.allowedActions.map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={
                          ['REJECT', 'CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'
                        }
                        onClick={() =>
                          setTransition({ resource: 'TRAVEL', item: selected.item, action })
                        }
                        disabled={!online}
                      >
                        {TRAVEL_ACTION_LABELS[action]}
                      </Button>
                    ))}
                    {['ADVANCED', 'IN_SETTLEMENT'].includes(selected.item.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          expenseOperationKey.current = createBenefitsIdempotencyKey();
                          setCreatePanel('EXPENSE');
                        }}
                        disabled={!online}
                      >
                        <Plus size={15} /> Gasto
                      </Button>
                    )}
                  </>
                )}
                {selected.resource === 'LOAN' &&
                  selected.item.allowedActions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={
                        ['REJECT', 'CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'
                      }
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
                      size="sm"
                      variant={['CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'}
                      onClick={() =>
                        setTransition({ resource: 'DEDUCTION', item: selected.item, action })
                      }
                      disabled={!online}
                    >
                      {DEDUCTION_ACTION_LABELS[action]}
                    </Button>
                  ))}
              </div>
              {selected.resource === 'TRAVEL' && (
                <div className="bnx-block">
                  <h3>Gastos y soportes</h3>
                  <div className="hr-ws-table-scroll bnx-subtable">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Fecha</th>
                          <th scope="col">Categoría</th>
                          <th scope="col" className="hr-amount-cell">Reclamado</th>
                          <th scope="col" className="hr-amount-cell">Reconocido</th>
                          <th scope="col">Soporte</th>
                          <th scope="col">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected.item.expenses ?? []).map((expense) => (
                          <tr key={expense.id}>
                            <td>{dateLabel(expense.occurredOn)}</td>
                            <td>{expense.category}</td>
                            <td className="hr-amount-cell">
                              {money(expense.currency, expense.claimedAmount)}
                            </td>
                            <td className="hr-amount-cell">
                              {money(expense.currency, expense.recognizedAmount)}
                            </td>
                            <td>{expense.evidence?.fileName ?? expense.receiptReference ?? '—'}</td>
                            <td>
                              <BenefitsStatusPill status={expense.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {selected.resource === 'LOAN' && (
                <>
                  <div className="bnx-block">
                    <h3>Calendario informativo del servidor</h3>
                    <div className="hr-ws-table-scroll bnx-subtable">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Vence</th>
                            <th scope="col" className="hr-amount-cell">Programado</th>
                            <th scope="col" className="hr-amount-cell">Pagado</th>
                            <th scope="col" className="hr-amount-cell">Saldo cuota</th>
                            <th scope="col">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.item.schedule ?? []).map((installment) => (
                            <tr key={installment.id}>
                              <td>{installment.number}</td>
                              <td>{dateLabel(installment.dueDate)}</td>
                              <td className="hr-amount-cell">
                                {money(selected.item.currency, installment.scheduledTotal)}
                              </td>
                              <td className="hr-amount-cell">
                                {money(selected.item.currency, installment.paidAmount)}
                              </td>
                              <td className="hr-amount-cell">
                                {money(selected.item.currency, installment.outstandingAmount)}
                              </td>
                              <td>
                                <BenefitsStatusPill status={installment.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bnx-block">
                    <h3>Ledger</h3>
                    <ul className="bnx-ledger">
                      {(selected.item.ledger ?? []).map((entry) => (
                        <li key={entry.id}>
                          <span>
                            <strong>{entry.type}</strong>
                            <small>
                              {dateLabel(entry.effectiveDate)} · {entry.reference ?? entry.reason}
                            </small>
                          </span>
                          <strong>{money(entry.currency, entry.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
              {selected.item.trace && (
                <div className="bnx-block">
                  <h3>Trazabilidad</h3>
                  <ol className="bnx-trace">
                    {selected.item.trace.map((event) => (
                      <li key={event.id}>
                        <span>{event.event}</span>
                        <small>
                          {dateLabel(event.occurredAt)} · {event.actor?.name ?? 'Sistema'} ·{' '}
                          {event.reason ?? 'Sin nota'}
                        </small>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : null}
        </div>
      </HrSection>
    ) : null;

  const summaryPanel = (
    <HrSection
      className="bnx-summary"
      eyebrow="Resumen"
      title={tabLabel}
      description={status ? 'Totales del estado filtrado.' : 'Totales de la bandeja cargada.'}
    >
      <dl className="bnx-summary-total">
        <div>
          <dt>{tab === 'LOAN' ? 'Saldo total' : 'Importe total'}</dt>
          <dd>
            {sumByCurrency(
              (filteredCards as Array<HrTravelRequest | HrLoan | HrDeduction>).map((entry) =>
                tab === 'TRAVEL'
                  ? {
                      currency: (entry as HrTravelRequest).currency,
                      amount:
                        (entry as HrTravelRequest).approvedAmount ??
                        (entry as HrTravelRequest).requestedAmount,
                    }
                  : tab === 'LOAN'
                    ? {
                        currency: (entry as HrLoan).currency,
                        amount: (entry as HrLoan).outstandingBalance,
                      }
                    : {
                        currency: (entry as HrDeduction).currency,
                        amount: (entry as HrDeduction).applicableAmount,
                      }
              )
            )}
          </dd>
          <small>{filteredCards.length} registros visibles</small>
        </div>
      </dl>
      {statusBreakdown.length > 0 ? (
        <ul className="bnx-status-list" aria-label="Registros por estado">
          {statusBreakdown.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                className={status === option.value ? 'active' : undefined}
                aria-pressed={status === option.value}
                onClick={() => setStatus(status === option.value ? '' : option.value)}
              >
                <span>{option.label}</span>
                <strong>{option.count}</strong>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bnx-muted">Sin registros en esta bandeja.</p>
      )}
    </HrSection>
  );

  const boardDescription = (item: BoardItem) =>
    tab === 'TRAVEL'
      ? `${(item as HrTravelRequest).destination} · ${dateLabel((item as HrTravelRequest).departureDate)} a ${dateLabel((item as HrTravelRequest).returnDate)}`
      : tab === 'LOAN'
        ? (item as HrLoan).purpose
        : `${(item as HrDeduction).name} · desde ${dateLabel((item as HrDeduction).effectiveFrom)}`;
  const boardAmount = (item: BoardItem) =>
    tab === 'TRAVEL'
      ? money(
          (item as HrTravelRequest).currency,
          (item as HrTravelRequest).approvedAmount ?? (item as HrTravelRequest).requestedAmount
        )
      : tab === 'LOAN'
        ? money((item as HrLoan).currency, (item as HrLoan).outstandingBalance)
        : money((item as HrDeduction).currency, (item as HrDeduction).applicableAmount);
  const boardNextLabel = (item: BoardItem) => {
    const nextAction = item.allowedActions[0];
    return !nextAction
      ? 'Sin acciones pendientes'
      : tab === 'TRAVEL'
        ? TRAVEL_ACTION_LABELS[nextAction as HrTravelRequest['allowedActions'][number]]
        : tab === 'LOAN'
          ? LOAN_ACTION_LABELS[nextAction as HrLoan['allowedActions'][number]]
          : DEDUCTION_ACTION_LABELS[nextAction as HrDeduction['allowedActions'][number]];
  };
  const boardColumns: CatalogColumn<BoardItem>[] = [
    { key: 'code', header: 'Código', render: (item) => <strong>{item.code}</strong> },
    { key: 'user', header: 'Empleado', render: (item) => item.user?.name ?? `Usuario #${item.userId}` },
    {
      key: 'description',
      header: tab === 'TRAVEL' ? 'Destino y fechas' : tab === 'LOAN' ? 'Motivo' : 'Deducción y vigencia',
      className: 'bnx-desc-cell',
      render: (item) => boardDescription(item),
    },
    {
      key: 'amount',
      header: tab === 'LOAN' ? 'Saldo' : 'Importe',
      align: 'right',
      className: 'hr-amount-cell',
      render: (item) => <strong>{boardAmount(item)}</strong>,
    },
    { key: 'status', header: 'Estado', render: (item) => <BenefitsStatusPill status={item.status} /> },
    {
      key: 'next',
      header: 'Siguiente paso',
      render: (item) => (
        <span className={item.allowedActions[0] ? 'bnx-next' : 'bnx-next is-idle'}>{boardNextLabel(item)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      className: 'hr-admin-actions-col',
      render: (item) => (
        <div className="table-actions">
          <Button
            className="table-action-btn"
            size="sm"
            variant="ghost"
            onClick={() => void openDetail({ resource: tab, item } as Selected)}
            title="Ver y gestionar"
            aria-label={`Ver y gestionar ${item.code}`}
          >
            <Eye size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <HrPage className="inventory-page hr-benefits-page hr-admin-catalog-page hr-operation-page prestaciones-page">
      {hero}
      <BenefitsOnlineNotice online={online} />
      {tabs}
      <HrToolbar className="bnx-toolbar" ariaLabel={`Filtros de ${tabLabel.toLocaleLowerCase('es-NI')}`}>
        <label className="hr-benefits-search is-wide">
          <span className="sr-only">Buscar</span>
          <span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar por código, empleado o detalle"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Código, empleado o detalle"
            />
          </span>
        </label>
        <label className="hr-benefits-status-filter">
          <span className="sr-only">Estado</span>
          <HrReactSelect value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos</option>
            {STATUS_OPTIONS[tab].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </HrReactSelect>
        </label>
        <div className="hr-ws-toolbar-actions">
          <Button variant="ghost" onClick={() => void load()} disabled={loading || !online}>
            <RefreshCw size={16} /> Actualizar
          </Button>
        </div>
      </HrToolbar>
      {loading && <LoadingSpinner text="Cargando beneficios financieros…" />}
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
        <div className="hr-benefits-admin-register" id={activePanelId} role="tabpanel" aria-label={tabLabel}>
          <HrSplit
            main={
              <>
                <HrTablePanel
                  className="hr-benefits-admin-board bnx-board"
                  aria-label={`Bandeja de ${tabLabel.toLocaleLowerCase('es-NI')}`}
                >
                  <CatalogTable<BoardItem>
                    ariaLabel={`${tabLabel}: ${filteredCards.length} registros`}
                    rows={pagedCards as BoardItem[]}
                    rowKey={(item) => `${tab}-${item.id}`}
                    columns={boardColumns}
                    rowClassName={(item) =>
                      selected?.resource === tab && selected.item.id === item.id ? 'is-selected' : undefined
                    }
                    pagination={{
                      page: tablePage,
                      totalPages: Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE)),
                      totalItems: filteredCards.length,
                      pageSize: PAGE_SIZE,
                      onPageChange: setTablePage,
                    }}
                    emptyLabel="Sin registros"
                    emptyState={
                      <div className="hr-admin-empty">
                        <strong>{search ? 'No hay coincidencias' : 'No hay registros para este estado'}</strong>
                        <span>{search ? 'Prueba otro código, empleado o detalle.' : 'Cambia el estado o crea un nuevo registro.'}</span>
                        {search && <Button size="sm" variant="ghost" onClick={() => setSearch('')}>Limpiar búsqueda</Button>}
                        {status && (
                          <Button size="sm" variant="ghost" onClick={() => setStatus('')}>
                            Mostrar todos
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setCreatePanel(tab)} disabled={!online}>
                          <Plus size={15} /> {createLabel}
                        </Button>
                      </div>
                    }
                  />
                </HrTablePanel>
                {detailPanel}
              </>
            }
            aside={summaryPanel}
          />
        </div>
      )}
      <Sidebar
        isOpen={Boolean(createPanel)}
        onClose={() => {
          if (!saving) {
            if (createPanel === 'EXPENSE') expenseOperationKey.current = null;
            setCreatePanel(null);
          }
        }}
        title={
          createPanel === 'TRAVEL'
            ? 'Nuevo viático'
            : createPanel === 'LOAN'
              ? 'Nueva solicitud de préstamo'
              : createPanel === 'DEDUCTION'
                ? 'Nueva deducción'
                : 'Registrar gasto'
        }
        width="large"
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
      </Sidebar>
      <Sidebar
        isOpen={Boolean(transition)}
        onClose={() => !saving && setTransition(null)}
        title="Confirmar transición"
        width="large"
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
      </Sidebar>
    </HrPage>
  );
}
