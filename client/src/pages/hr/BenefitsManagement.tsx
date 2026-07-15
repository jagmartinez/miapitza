import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHrMoney } from '../../utils/hrFormat';
import {
  AlertTriangle,
  Banknote,
  FileMinus2,
  WalletCards,
  Plus,
  Receipt,
  RefreshCw,
  Route,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import BenefitsOnlineNotice from '../../components/hr/BenefitsOnlineNotice';
import BenefitsStatusPill from '../../components/hr/BenefitsStatusPill';
import BenefitsTransitionForm from '../../components/hr/BenefitsTransitionForm';
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

type Tab = 'TRAVEL' | 'LOAN' | 'DEDUCTION';
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
      const [org, travelResult, loanResult, deductionResult] = await Promise.all([
        hrClient.getOrganization(),
        benefitsClient.getTravelRequests(filters),
        benefitsClient.getLoans(filters),
        benefitsClient.getDeductions(filters),
      ]);
      setOrganization(org);
      setTravel(travelResult.items);
      setLoans(loanResult.items);
      setDeductions(deductionResult.items);
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
      await benefitsClient.addTravelExpense(
        selected.item.id,
        payload,
        idempotencyKey
      );
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
  const internalUsers = (organization.users ?? []).filter(
    (user) => user.accountType === 'INTERNAL' && Boolean(user.employeeId ?? user.employee?.id)
  );

  return (
    <div className="page-wrapper hr-benefits-page">
      <PageHeader
        title="Viáticos, préstamos y deducciones"
        subtitle="Flujos financieros auditables y conectados con nómina"
        icon={WalletCards}
        actions={
          <div className="hr-benefits-header-actions">
            <Button variant="secondary" onClick={() => setCreatePanel(tab)} disabled={!online}>
              <Plus size={17} aria-hidden="true" />{' '}
              {tab === 'TRAVEL' ? 'Viático' : tab === 'LOAN' ? 'Préstamo' : 'Deducción'}
            </Button>
          </div>
        }
      />
      <BenefitsOnlineNotice online={online} />
      <div className="hr-benefits-toolbar">
        <div className="hr-benefits-tabs" role="tablist" aria-label="Beneficios financieros">
          <button
            role="tab"
            aria-selected={tab === 'TRAVEL'}
            onClick={() => {
              setTab('TRAVEL');
              setSelected(null);
            }}
          >
            <Route size={17} /> Viáticos <span>{travel.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'LOAN'}
            onClick={() => {
              setTab('LOAN');
              setSelected(null);
            }}
          >
            <Banknote size={17} /> Préstamos <span>{loans.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'DEDUCTION'}
            onClick={() => {
              setTab('DEDUCTION');
              setSelected(null);
            }}
          >
            <FileMinus2 size={17} /> Deducciones <span>{deductions.length}</span>
          </button>
        </div>
        <label>
          Estado{' '}
          <input
            value={status}
            onChange={(event) => setStatus(event.target.value.toUpperCase())}
            placeholder="Todos"
          />
        </label>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || !online}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </div>
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
        <div className="hr-benefits-layout">
          <section className="hr-benefits-list" aria-label={`Lista de ${tab.toLowerCase()}`}>
            {cards.length === 0 ? (
              <div className="hr-benefits-empty">
                <Receipt size={36} />
                <p>No hay registros para los filtros seleccionados.</p>
              </div>
            ) : (
              cards.map((entry) => {
                const resource = tab;
                const item = entry as HrTravelRequest | HrLoan | HrDeduction;
                const subtitle =
                  resource === 'TRAVEL'
                    ? `${(item as HrTravelRequest).destination} · ${dateLabel((item as HrTravelRequest).departureDate)}`
                    : resource === 'LOAN'
                      ? (item as HrLoan).purpose
                      : (item as HrDeduction).name;
                const amount =
                  resource === 'TRAVEL'
                    ? money(
                        (item as HrTravelRequest).currency,
                        (item as HrTravelRequest).approvedAmount ??
                          (item as HrTravelRequest).requestedAmount
                      )
                    : resource === 'LOAN'
                      ? money((item as HrLoan).currency, (item as HrLoan).outstandingBalance)
                      : money(
                          (item as HrDeduction).currency,
                          (item as HrDeduction).applicableAmount
                        );
                return (
                  <button
                    type="button"
                    key={`${resource}-${item.id}`}
                    className={
                      selected?.resource === resource && selected.item.id === item.id
                        ? 'selected'
                        : ''
                    }
                    onClick={() => void openDetail({ resource, item } as Selected)}
                  >
                    <span>
                      <strong>{item.code}</strong>
                      <small>{item.user?.name ?? `Usuario #${item.userId}`}</small>
                      <small>{subtitle}</small>
                    </span>
                    <span className="hr-benefits-list-amount">
                      <strong>{amount}</strong>
                      <BenefitsStatusPill status={item.status} />
                    </span>
                  </button>
                );
              })
            )}
          </section>
          <section className="hr-benefits-workspace" aria-live="polite">
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
                  <BenefitsStatusPill status={selected.item.status} />
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
                          {money(selected.item.currency, selected.item.employeeReimbursementAmount)}
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
                          ['REJECT', 'CANCEL', 'REVERSE'].includes(action) ? 'danger' : 'secondary'
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
                            <th>Fecha</th>
                            <th>Categoría</th>
                            <th>Reclamado</th>
                            <th>Reconocido</th>
                            <th>Soporte</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.item.expenses ?? []).map((expense) => (
                            <tr key={expense.id}>
                              <td>{dateLabel(expense.occurredOn)}</td>
                              <td>{expense.category}</td>
                              <td className="hr-amount-cell">{money(expense.currency, expense.claimedAmount)}</td>
                              <td className="hr-amount-cell">{money(expense.currency, expense.recognizedAmount)}</td>
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
                            <th>#</th>
                            <th>Vence</th>
                            <th>Programado</th>
                            <th>Pagado</th>
                            <th>Saldo cuota</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.item.schedule ?? []).map((installment) => (
                            <tr key={installment.id}>
                              <td>{installment.number}</td>
                              <td>{dateLabel(installment.dueDate)}</td>
                              <td className="hr-amount-cell">{money(selected.item.currency, installment.scheduledTotal)}</td>
                              <td className="hr-amount-cell">{money(selected.item.currency, installment.paidAmount)}</td>
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
            ) : (
              <div className="hr-benefits-empty workspace">
                <WalletCards size={44} />
                <h2>Selecciona un registro</h2>
                <p>Verás saldos, calendario, soportes y trazabilidad calculados por el servidor.</p>
              </div>
            )}
          </section>
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
        width="wide"
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
        width="wide"
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
