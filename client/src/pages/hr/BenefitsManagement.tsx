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
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import Sidebar from '../../components/Sidebar';
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
  const actionableCount = filteredCards.filter((entry) => entry.allowedActions.length > 0).length;
  const closedCount = filteredCards.filter((entry) =>
    ['SETTLED', 'PAID', 'CLOSED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(entry.status)
  ).length;
  useEffect(() => {
    setTablePage((page) => Math.min(page, Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))));
  }, [filteredCards.length]);
  const internalUsers = (organization.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );
  const activePanelId = `benefits-panel-${tab.toLowerCase()}`;

  if (tab === 'GOVERNANCE') {
    return (
      <div className="page-wrapper inventory-page hr-benefits-page hr-admin-catalog-page hr-operation-page">
        <PageHeader
          className="inventory-header-new hr-operation-header"
          title="Beneficios y liquidaciones"
          subtitle="Opera viáticos, préstamos, deducciones, políticas y cierres laborales desde una sola vista."
          icon={WalletCards}
        />
        <div className="hr-benefits-toolbar inventory-filters-row hr-operation-toolbar">
          <div
            className="hr-benefits-tabs inventory-status-filters"
            role="tablist"
            aria-label="Administración de beneficios"
          >
            {(
              [
                ['TRAVEL', 'Viáticos'],
                ['LOAN', 'Préstamos'],
                ['DEDUCTION', 'Deducciones'],
                ['GOVERNANCE', 'Liquidaciones y políticas'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`benefits-panel-${value.toLowerCase()}`}
                onClick={() => {
                  setTab(value);
                  setStatus('');
                  setSelected(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <section id={activePanelId} role="tabpanel" aria-label="Liquidaciones y políticas">
          <BenefitsGovernance embedded />
        </section>
      </div>
    );
  }

  return (
    <div className="page-wrapper inventory-page hr-benefits-page hr-admin-catalog-page hr-operation-page">
      <PageHeader
        className="inventory-header-new hr-operation-header"
        title="Viáticos, préstamos y deducciones"
        subtitle="Aprueba solicitudes, registra pagos y controla lo que se descontará en nómina"
        icon={WalletCards}
        actions={
          <div className="hr-benefits-header-actions">
            <Button variant="secondary" onClick={() => setCreatePanel(tab)} disabled={!online}>
              <Plus size={17} aria-hidden="true" />{' '}
              {tab === 'TRAVEL'
                ? 'Nuevo viático'
                : tab === 'LOAN'
                  ? 'Nuevo préstamo'
                  : 'Nueva deducción'}
            </Button>
          </div>
        }
      />
      <BenefitsOnlineNotice online={online} />
      <div className="hr-benefits-toolbar inventory-filters-row hr-operation-toolbar">
        <div
          className="hr-benefits-tabs inventory-status-filters"
          role="tablist"
          aria-label="Beneficios financieros"
        >
          <button
            role="tab"
            aria-selected={tab === 'TRAVEL'}
            aria-controls="benefits-panel-travel"
            onClick={() => {
              setTab('TRAVEL');
              setStatus('');
              setSelected(null);
            }}
          >
            <Route size={17} /> Viáticos <span>{travel.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'LOAN'}
            aria-controls="benefits-panel-loan"
            onClick={() => {
              setTab('LOAN');
              setStatus('');
              setSelected(null);
            }}
          >
            <Banknote size={17} /> Préstamos <span>{loans.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'DEDUCTION'}
            aria-controls="benefits-panel-deduction"
            onClick={() => {
              setTab('DEDUCTION');
              setStatus('');
              setSelected(null);
            }}
          >
            <FileMinus2 size={17} /> Deducciones <span>{deductions.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={false}
            aria-controls="benefits-panel-governance"
            onClick={() => {
              setTab('GOVERNANCE');
              setStatus('');
              setSelected(null);
            }}
          >
            <ShieldCheck size={17} /> Liquidaciones y políticas
          </button>
        </div>
        <label className="hr-benefits-search">
          Buscar
          <span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Código, empleado o detalle"
            />
          </span>
        </label>
        <label>
          Estado
          <HrReactSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            {STATUS_OPTIONS[tab].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </HrReactSelect>
        </label>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || !online}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </div>
      {!loading && !error && (
        <section className="hr-operation-kpis" aria-label="Resumen de la bandeja financiera">
          <article><WalletCards size={19} aria-hidden="true" /><span>Registros visibles</span><strong>{filteredCards.length}</strong><small>Según estado y búsqueda</small></article>
          <article className={actionableCount > 0 ? 'is-warning' : undefined}><Eye size={19} aria-hidden="true" /><span>Con siguiente paso</span><strong>{actionableCount}</strong><small>Acciones habilitadas por el servidor</small></article>
          <article><ShieldCheck size={19} aria-hidden="true" /><span>Finalizados</span><strong>{closedCount}</strong><small>Incluye cierres, rechazos y cancelaciones</small></article>
        </section>
      )}
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
        <>
          <div className="hr-benefits-admin-register" id={activePanelId} role="tabpanel" aria-label={tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones'}>
            <section
              className="hr-admin-board pr-table-card hr-benefits-admin-board"
              aria-label={`Bandeja de ${tab === 'TRAVEL' ? 'viáticos' : tab === 'LOAN' ? 'préstamos' : 'deducciones'}`}
            >
              <div className="hr-admin-table-wrap">
                <table className="hr-admin-table inventory-table">
                  <caption>
                    {tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones'}:{' '}
                    {filteredCards.length} registro(s)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Código</th>
                      <th scope="col">Empleado</th>
                      <th scope="col">
                        {tab === 'TRAVEL'
                          ? 'Destino y fechas'
                          : tab === 'LOAN'
                            ? 'Motivo'
                            : 'Deducción y vigencia'}
                      </th>
                      <th scope="col">{tab === 'LOAN' ? 'Saldo' : 'Importe'}</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Siguiente paso</th>
                      <th scope="col" className="hr-admin-actions-col">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="hr-admin-empty">
                            <strong>{search ? 'No hay coincidencias' : 'No hay registros para este estado'}</strong>
                            <span>{search ? 'Prueba otro código, empleado o detalle.' : 'Cambia el estado o crea un nuevo registro.'}</span>
                            {search && <Button size="sm" variant="ghost" onClick={() => setSearch('')}>Limpiar búsqueda</Button>}
                            {status && (
                              <Button size="sm" variant="ghost" onClick={() => setStatus('')}>
                                Mostrar todos
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => setCreatePanel(tab)}
                              disabled={!online}
                            >
                              <Plus size={15} />{' '}
                              {tab === 'TRAVEL'
                                ? 'Nuevo viático'
                                : tab === 'LOAN'
                                  ? 'Nuevo préstamo'
                                  : 'Nueva deducción'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pagedCards.map((entry) => {
                        const resource = tab;
                        const item = entry as HrTravelRequest | HrLoan | HrDeduction;
                        const description =
                          resource === 'TRAVEL'
                            ? `${(item as HrTravelRequest).destination} · ${dateLabel((item as HrTravelRequest).departureDate)} a ${dateLabel((item as HrTravelRequest).returnDate)}`
                            : resource === 'LOAN'
                              ? (item as HrLoan).purpose
                              : `${(item as HrDeduction).name} · desde ${dateLabel((item as HrDeduction).effectiveFrom)}`;
                        const amount =
                          resource === 'TRAVEL'
                            ? money(
                                (item as HrTravelRequest).currency,
                                (item as HrTravelRequest).approvedAmount ??
                                  (item as HrTravelRequest).requestedAmount
                              )
                            : resource === 'LOAN'
                              ? money(
                                  (item as HrLoan).currency,
                                  (item as HrLoan).outstandingBalance
                                )
                              : money(
                                  (item as HrDeduction).currency,
                                  (item as HrDeduction).applicableAmount
                                );
                        const nextAction = item.allowedActions[0];
                        const nextLabel = !nextAction
                          ? 'Sin acciones pendientes'
                          : resource === 'TRAVEL'
                            ? TRAVEL_ACTION_LABELS[
                                nextAction as HrTravelRequest['allowedActions'][number]
                              ]
                            : resource === 'LOAN'
                              ? LOAN_ACTION_LABELS[nextAction as HrLoan['allowedActions'][number]]
                              : DEDUCTION_ACTION_LABELS[
                                  nextAction as HrDeduction['allowedActions'][number]
                                ];
                        return (
                          <tr
                            key={`${resource}-${item.id}`}
                            className={
                              selected?.resource === resource && selected.item.id === item.id
                                ? 'is-selected'
                                : ''
                            }
                          >
                            <td>
                              <strong>{item.code}</strong>
                            </td>
                            <td>{item.user?.name ?? `Usuario #${item.userId}`}</td>
                            <td>{description}</td>
                            <td>
                              <strong>{amount}</strong>
                            </td>
                            <td>
                              <BenefitsStatusPill status={item.status} />
                            </td>
                            <td>{nextLabel}</td>
                            <td className="hr-admin-actions-col">
                              <div className="table-actions">
                                <Button
                                  className="table-action-btn"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void openDetail({ resource, item } as Selected)}
                                  title="Ver y gestionar"
                                  aria-label={`Ver y gestionar ${item.code}`}
                                >
                                  <Eye size={16} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={tablePage}
                totalPages={Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE))}
                totalItems={filteredCards.length}
                pageSize={PAGE_SIZE}
                onPageChange={setTablePage}
                alwaysShow
                emptyLabel="Sin registros"
              />
            </section>
            <section
              className={`hr-benefits-workspace ${selected || detailLoading ? 'is-visible' : 'is-empty'}`}
              aria-live="polite"
            >
              {detailLoading ? (
                <LoadingSpinner text="Abriendo detalle…" />
              ) : selected ? (
                <>
                  <div className="hr-benefits-workspace-head">
                    <div>
                      <small>
                        {selected.resource === 'TRAVEL'
                          ? 'Viático'
                          : selected.resource === 'LOAN'
                            ? 'Préstamo'
                            : 'Deducción'}
                      </small>
                      <h2>{selected.item.code}</h2>
                      <p>{selected.item.user?.name ?? `Usuario #${selected.item.userId}`}</p>
                    </div>
                    <div className="hr-benefits-workspace-controls"><BenefitsStatusPill status={selected.item.status} /><Button size="sm" variant="ghost" onClick={() => setSelected(null)} aria-label="Cerrar detalle" title="Cerrar detalle"><X size={16} /></Button></div>
                  </div>
                  <div className="hr-benefits-metrics">
                    {selected.resource === 'TRAVEL' && (
                      <>
                        <div>
                          <span>Solicitado</span>
                          <strong>
                            {money(selected.item.currency, selected.item.requestedAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Anticipo</span>
                          <strong>
                            {money(selected.item.currency, selected.item.advanceAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Devolución</span>
                          <strong>
                            {money(selected.item.currency, selected.item.employeeReturnAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Reembolso</span>
                          <strong>
                            {money(
                              selected.item.currency,
                              selected.item.employeeReimbursementAmount
                            )}
                          </strong>
                        </div>
                      </>
                    )}
                    {selected.resource === 'LOAN' && (
                      <>
                        <div>
                          <span>Solicitado</span>
                          <strong>
                            {money(selected.item.currency, selected.item.requestedAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Saldo</span>
                          <strong>
                            {money(selected.item.currency, selected.item.outstandingBalance)}
                          </strong>
                        </div>
                        <div>
                          <span>Cuotas</span>
                          <strong>{selected.item.installmentCount}</strong>
                        </div>
                        <div>
                          <span>Descuento nómina</span>
                          <strong>{selected.item.payrollDeductionRequested ? 'Sí' : 'No'}</strong>
                        </div>
                      </>
                    )}
                    {selected.resource === 'DEDUCTION' && (
                      <>
                        <div>
                          <span>Aplicable</span>
                          <strong>
                            {money(selected.item.currency, selected.item.applicableAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Remanente</span>
                          <strong>
                            {money(selected.item.currency, selected.item.remainingAmount)}
                          </strong>
                        </div>
                        <div>
                          <span>Prioridad</span>
                          <strong>{selected.item.priority}</strong>
                        </div>
                        <div>
                          <span>Vigencia</span>
                          <strong>{dateLabel(selected.item.effectiveFrom)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="hr-benefits-actions">
                    {selected.resource === 'TRAVEL' && (
                      <>
                        {selected.item.allowedActions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={
                              ['REJECT', 'CANCEL', 'REVERSE'].includes(action)
                                ? 'danger'
                                : 'secondary'
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
                            ['REJECT', 'CANCEL', 'REVERSE'].includes(action)
                              ? 'danger'
                              : 'secondary'
                          }
                          onClick={() =>
                            setTransition({ resource: 'LOAN', item: selected.item, action })
                          }
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
                    <>
                      <h3>Gastos y soportes</h3>
                      <div className="hr-benefits-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Fecha</th>
                              <th scope="col">Categoría</th>
                              <th scope="col">Reclamado</th>
                              <th scope="col">Reconocido</th>
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
                                <td>
                                  {expense.evidence?.fileName ?? expense.receiptReference ?? '—'}
                                </td>
                                <td>
                                  <BenefitsStatusPill status={expense.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {selected.resource === 'LOAN' && (
                    <>
                      <h3>Calendario informativo del servidor</h3>
                      <div className="hr-benefits-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">#</th>
                              <th scope="col">Vence</th>
                              <th scope="col">Programado</th>
                              <th scope="col">Pagado</th>
                              <th scope="col">Saldo cuota</th>
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
                      <h3>Ledger</h3>
                      <div className="hr-benefits-ledger">
                        {(selected.item.ledger ?? []).map((entry) => (
                          <div key={entry.id}>
                            <span>
                              <strong>{entry.type}</strong>
                              <small>
                                {dateLabel(entry.effectiveDate)} · {entry.reference ?? entry.reason}
                              </small>
                            </span>
                            <strong>{money(entry.currency, entry.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {selected.item.trace && (
                    <>
                      <h3>Trazabilidad</h3>
                      <div className="hr-benefits-trace">
                        {selected.item.trace.map((event) => (
                          <div key={event.id}>
                            <span>{event.event}</span>
                            <small>
                              {dateLabel(event.occurredAt)} · {event.actor?.name ?? 'Sistema'} ·{' '}
                              {event.reason ?? 'Sin nota'}
                            </small>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </section>
          </div>
        </>
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
    </div>
  );
}
