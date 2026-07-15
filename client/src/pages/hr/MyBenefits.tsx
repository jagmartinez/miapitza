import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  FileMinus2,
  WalletCards,
  Plus,
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
import type { HrNamedEntity } from '../../types/hr';
import type {
  HrBenefitsActionInput,
  HrBenefitsTransitionPayload,
  HrDeduction,
  HrLoan,
  HrLoanRequestPayload,
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
type SelfTravelAction = 'SUBMIT' | 'START_SETTLEMENT' | 'CANCEL';

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(parsed);
}

function money(currency: string, amount?: string | null): string {
  return `${currency} ${amount ?? '0.00'}`;
}

export default function MyBenefits() {
  const online = useBenefitsOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [tab, setTab] = useState<Tab>('TRAVEL');
  const [branches, setBranches] = useState<HrNamedEntity[]>([]);
  const [travel, setTravel] = useState<HrTravelRequest[]>([]);
  const [loans, setLoans] = useState<HrLoan[]>([]);
  const [deductions, setDeductions] = useState<HrDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [panel, setPanel] = useState<'TRAVEL' | 'LOAN' | 'EXPENSE' | null>(null);
  const expenseOperationKey = useRef<string | null>(null);
  const [transition, setTransition] = useState<{
    item: HrTravelRequest;
    action: SelfTravelAction;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [organization, travelResult, loanResult, deductionResult] = await Promise.all([
        hrClient.getOrganization(),
        benefitsClient.getMyTravelRequests({ limit: 100 }),
        benefitsClient.getMyLoans({ limit: 100 }),
        benefitsClient.getMyDeductions({ limit: 100 }),
      ]);
      setBranches(organization.branches ?? []);
      setTravel(travelResult.items);
      setLoans(loanResult.items);
      setDeductions(deductionResult.items);
    } catch (loadError) {
      setTravel([]);
      setLoans([]);
      setDeductions([]);
      setError(
        getBenefitsErrorMessage(loadError, 'No fue posible cargar tus beneficios financieros.')
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (selection: Selected) => {
    setDetailLoading(true);
    try {
      if (selection.resource === 'TRAVEL')
        setSelected({
          resource: 'TRAVEL',
          item: await benefitsClient.getMyTravelRequest(selection.item.id),
        });
      else if (selection.resource === 'LOAN')
        setSelected({ resource: 'LOAN', item: await benefitsClient.getMyLoan(selection.item.id) });
      else
        setSelected({
          resource: 'DEDUCTION',
          item: await benefitsClient.getMyDeduction(selection.item.id),
        });
    } catch (detailError) {
      showError(getBenefitsErrorMessage(detailError, 'No fue posible abrir el detalle.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshSelection = async (selection: Selected) => {
    await load();
    await openDetail(selection);
  };

  const createTravel = async (payload: HrTravelRequestPayload) => {
    setSaving(true);
    try {
      const created = await benefitsClient.createMyTravelRequest(
        payload,
        createBenefitsIdempotencyKey()
      );
      showSuccess('Tu viático quedó guardado como borrador.');
      setPanel(null);
      await refreshSelection({ resource: 'TRAVEL', item: created });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible crear tu viático.'));
    } finally {
      setSaving(false);
    }
  };

  const createLoan = async (payload: HrLoanRequestPayload) => {
    setSaving(true);
    try {
      const created = await benefitsClient.createMyLoanRequest(
        payload,
        createBenefitsIdempotencyKey()
      );
      showSuccess('Tu solicitud fue enviada para revisión.');
      setPanel(null);
      await refreshSelection({ resource: 'LOAN', item: created });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible enviar tu solicitud.'));
    } finally {
      setSaving(false);
    }
  };

  const addExpense = async (payload: HrTravelExpensePayload) => {
    if (selected?.resource !== 'TRAVEL') return;
    const idempotencyKey = expenseOperationKey.current ?? createBenefitsIdempotencyKey();
    expenseOperationKey.current = idempotencyKey;
    setSaving(true);
    try {
      await benefitsClient.addMyTravelExpense(
        selected.item.id,
        payload,
        idempotencyKey
      );
      showSuccess('Gasto agregado a tu liquidación.');
      expenseOperationKey.current = null;
      setPanel(null);
      await refreshSelection(selected);
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible registrar el gasto.'));
    } finally {
      setSaving(false);
    }
  };

  const transitionTravel = async (input: HrBenefitsActionInput) => {
    if (!transition) return;
    setSaving(true);
    const payload: HrBenefitsTransitionPayload = {
      reason: input.reason,
      confirmed: true,
      expectedRevision: input.expectedRevision,
      effectiveDate: input.effectiveDate,
      reference: input.operationReference,
    };
    try {
      const item = await benefitsClient.transitionMyTravel(
        transition.item.id,
        transition.action,
        payload,
        createBenefitsIdempotencyKey()
      );
      showSuccess('Solicitud actualizada.');
      setTransition(null);
      await refreshSelection({ resource: 'TRAVEL', item });
    } catch (mutationError) {
      showError(getBenefitsErrorMessage(mutationError, 'No fue posible actualizar tu viático.'));
    } finally {
      setSaving(false);
    }
  };

  const items = tab === 'TRAVEL' ? travel : tab === 'LOAN' ? loans : deductions;

  return (
    <div className="page-wrapper hr-benefits-page hr-my-benefits-page">
      <PageHeader
        title="Mis viáticos y beneficios"
        subtitle="Solicitudes, saldos, cuotas y deducciones publicadas"
        icon={WalletCards}
        actions={
          tab !== 'DEDUCTION' ? (
            <Button onClick={() => setPanel(tab)} disabled={!online}>
              <Plus size={17} /> {tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'}
            </Button>
          ) : undefined
        }
      />
      <BenefitsOnlineNotice online={online} />
      <div className="hr-benefits-toolbar self">
        <div className="hr-benefits-tabs" role="tablist" aria-label="Mis beneficios">
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
        <Button variant="ghost" onClick={() => void load()} disabled={loading || !online}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </div>
      {loading && <LoadingSpinner text="Cargando tus beneficios…" />}
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
          <section className="hr-benefits-list" aria-label="Mis registros">
            {items.length === 0 ? (
              <div className="hr-benefits-empty">
                <WalletCards size={36} />
                <p>No tienes registros en esta sección.</p>
              </div>
            ) : (
              items.map((entry) => {
                const item = entry as HrTravelRequest | HrLoan | HrDeduction;
                const amount =
                  tab === 'TRAVEL'
                    ? money(
                        (item as HrTravelRequest).currency,
                        (item as HrTravelRequest).approvedAmount ??
                          (item as HrTravelRequest).requestedAmount
                      )
                    : tab === 'LOAN'
                      ? money((item as HrLoan).currency, (item as HrLoan).outstandingBalance)
                      : money(
                          (item as HrDeduction).currency,
                          (item as HrDeduction).applicableAmount
                        );
                return (
                  <button
                    type="button"
                    key={`${tab}-${item.id}`}
                    className={
                      selected?.resource === tab && selected.item.id === item.id ? 'selected' : ''
                    }
                    onClick={() => void openDetail({ resource: tab, item } as Selected)}
                  >
                    <span>
                      <strong>{item.code}</strong>
                      <small>
                        {tab === 'TRAVEL'
                          ? (item as HrTravelRequest).destination
                          : tab === 'LOAN'
                            ? (item as HrLoan).purpose
                            : (item as HrDeduction).name}
                      </small>
                      <small>Actualizado {dateLabel(item.updatedAt)}</small>
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
                        ? 'Mi viático'
                        : selected.resource === 'LOAN'
                          ? 'Mi préstamo'
                          : 'Mi deducción'}
                    </small>
                    <h2>{selected.item.code}</h2>
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
                        <span>Aprobado</span>
                        <strong>
                          {money(selected.item.currency, selected.item.approvedAmount)}
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
                        <span>Desembolsado</span>
                        <strong>
                          {money(selected.item.currency, selected.item.disbursedAmount)}
                        </strong>
                      </div>
                      <div>
                        <span>Saldo vigente</span>
                        <strong>
                          {money(selected.item.currency, selected.item.outstandingBalance)}
                        </strong>
                      </div>
                      <div>
                        <span>Cuotas</span>
                        <strong>{selected.item.installmentCount}</strong>
                      </div>
                      <div>
                        <span>Primera fecha</span>
                        <strong>{dateLabel(selected.item.firstDueDate)}</strong>
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
                        <span>Límite periodo</span>
                        <strong>
                          {money(selected.item.currency, selected.item.perPeriodLimit)}
                        </strong>
                      </div>
                      <div>
                        <span>Vigencia</span>
                        <strong>{dateLabel(selected.item.effectiveFrom)}</strong>
                      </div>
                    </>
                  )}
                </div>
                {selected.resource === 'TRAVEL' && (
                  <>
                    <div className="hr-benefits-actions">
                      {selected.item.allowedActions
                        .filter((action): action is SelfTravelAction =>
                          ['SUBMIT', 'START_SETTLEMENT', 'CANCEL'].includes(action)
                        )
                        .map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === 'CANCEL' ? 'danger' : 'secondary'}
                            onClick={() => setTransition({ item: selected.item, action })}
                            disabled={!online}
                          >
                            {action === 'SUBMIT'
                              ? 'Enviar'
                              : action === 'START_SETTLEMENT'
                                ? 'Iniciar liquidación'
                                : 'Cancelar'}
                          </Button>
                        ))}
                      {['ADVANCED', 'IN_SETTLEMENT'].includes(selected.item.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            expenseOperationKey.current = createBenefitsIdempotencyKey();
                            setPanel('EXPENSE');
                          }}
                          disabled={!online}
                        >
                          <Plus size={15} /> Agregar gasto
                        </Button>
                      )}
                    </div>
                    <h3>Gastos reportados</h3>
                    <div className="hr-benefits-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Descripción</th>
                            <th>Reclamado</th>
                            <th>Reconocido</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.item.expenses ?? []).map((expense) => (
                            <tr key={expense.id}>
                              <td>{dateLabel(expense.occurredOn)}</td>
                              <td>{expense.description}</td>
                              <td>{money(expense.currency, expense.claimedAmount)}</td>
                              <td>{money(expense.currency, expense.recognizedAmount)}</td>
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
                    <div className="hr-benefits-authority-note">
                      El calendario es informativo y autoritativo del servidor. No se recalcula en
                      tu navegador.
                    </div>
                    <h3>Calendario</h3>
                    <div className="hr-benefits-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Vence</th>
                            <th>Cuota</th>
                            <th>Pagado</th>
                            <th>Saldo</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.item.schedule ?? []).map((installment) => (
                            <tr key={installment.id}>
                              <td>{installment.number}</td>
                              <td>{dateLabel(installment.dueDate)}</td>
                              <td>{money(selected.item.currency, installment.scheduledTotal)}</td>
                              <td>{money(selected.item.currency, installment.paidAmount)}</td>
                              <td>
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
                    <h3>Movimientos</h3>
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
                {selected.resource === 'DEDUCTION' && (
                  <div className="hr-benefits-authority-note">
                    Sólo se muestran deducciones asignadas a tu identidad. La nómina aplica límites,
                    prioridad y vigencia de forma idempotente.
                  </div>
                )}
              </>
            ) : (
              <div className="hr-benefits-empty workspace">
                <WalletCards size={44} />
                <h2>Selecciona un registro</h2>
                <p>Consulta importes, saldos y estados publicados por el servidor.</p>
              </div>
            )}
          </section>
        </div>
      )}
      <Sidebar
        isOpen={Boolean(panel)}
        onClose={() => {
          if (!saving) {
            if (panel === 'EXPENSE') expenseOperationKey.current = null;
            setPanel(null);
          }
        }}
        title={
          panel === 'TRAVEL'
            ? 'Solicitar viático'
            : panel === 'LOAN'
              ? 'Solicitar préstamo'
              : 'Registrar gasto'
        }
        width="wide"
      >
        {panel === 'TRAVEL' && (
          <TravelRequestForm
            branches={branches}
            selfService
            online={online}
            saving={saving}
            onSubmit={createTravel}
            onCancel={() => setPanel(null)}
          />
        )}
        {panel === 'LOAN' && (
          <LoanRequestForm
            selfService
            online={online}
            saving={saving}
            onSubmit={createLoan}
            onCancel={() => setPanel(null)}
          />
        )}
        {panel === 'EXPENSE' && (
          <TravelExpenseForm
            online={online}
            saving={saving}
            onSubmit={addExpense}
            onCancel={() => {
              expenseOperationKey.current = null;
              setPanel(null);
            }}
          />
        )}
      </Sidebar>
      <Sidebar
        isOpen={Boolean(transition)}
        onClose={() => !saving && setTransition(null)}
        title="Confirmar acción"
        width="wide"
      >
        {transition && (
          <BenefitsTransitionForm
            code={transition.item.code}
            revision={transition.item.revision}
            action={transition.action}
            resource="TRAVEL"
            online={online}
            saving={saving}
            onSubmit={transitionTravel}
            onCancel={() => setTransition(null)}
          />
        )}
      </Sidebar>
    </div>
  );
}
