import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHrMoney } from '../../utils/hrDisplay';
import {
  AlertTriangle,
  Banknote,
  Eye,
  FileMinus2,
  WalletCards,
  Plus,
  RefreshCw,
  Route,
} from 'lucide-react';
import { DataTable, PageHeader, FullScreenModal, Button } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
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
import './self-service.css';

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
  return formatHrMoney(currency, amount);
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
  const actionableCount = items.filter((entry) => entry.allowedActions.length > 0).length;
  const closedCount = items.filter((entry) =>
    ['SETTLED', 'PAID', 'CLOSED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(entry.status)
  ).length;
  const activePanelId = `my-benefits-panel-${tab.toLowerCase()}`;


  return (
    <div className="page-wrapper hr-benefits-page hr-my-benefits-page my-hr-page">
      <PageHeader
        title="Mis viáticos y beneficios"
        description="Consulta solicitudes, saldos, cuotas y deducciones con su estado oficial"
        actions={
          <>
            {tab !== 'DEDUCTION' && (
              <Button variant="primary" onClick={() => setPanel(tab)} disabled={!online}>
                <Plus size={17} /> {tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'}
              </Button>
            )}
            <MyHrNav />
          </>
        }
      />
      {!online && <BenefitsOnlineNotice online={false} />}
      {!loading && !error && (
        <section className="my-hr-summary-grid" aria-label="Resumen de mis beneficios">
          <article><WalletCards size={19} aria-hidden="true" /><span>Registros visibles</span><strong>{items.length}</strong><small>{tab === 'TRAVEL' ? 'Viáticos' : tab === 'LOAN' ? 'Préstamos' : 'Deducciones'}</small></article>
          <article className={actionableCount > 0 ? 'is-warning' : undefined}><RefreshCw size={19} aria-hidden="true" /><span>Con siguiente paso</span><strong>{actionableCount}</strong><small>Acciones permitidas por el servidor</small></article>
          <article><FileMinus2 size={19} aria-hidden="true" /><span>Finalizados</span><strong>{closedCount}</strong><small>Incluye cancelados o rechazados</small></article>
        </section>
      )}
      <div className="hr-benefits-toolbar self my-hr-toolbar">
        <div className="hr-benefits-tabs" role="tablist" aria-label="Mis beneficios">
          <button
            type="button"
            role="tab"
            id="my-benefits-tab-travel"
            aria-controls="my-benefits-panel-travel"
            aria-selected={tab === 'TRAVEL'}
            onClick={() => {
              setTab('TRAVEL');
              setSelected(null);
            }}
          >
            <Route size={17} /> Viáticos <span>{travel.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="my-benefits-tab-loan"
            aria-controls="my-benefits-panel-loan"
            aria-selected={tab === 'LOAN'}
            onClick={() => {
              setTab('LOAN');
              setSelected(null);
            }}
          >
            <Banknote size={17} /> Préstamos <span>{loans.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="my-benefits-tab-deduction"
            aria-controls="my-benefits-panel-deduction"
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
      {loading && <HrLoading text="Cargando tus beneficios…" />}
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
        <div className="hr-benefits-layout" id={activePanelId} role="tabpanel" aria-labelledby={`my-benefits-tab-${tab.toLowerCase()}`} tabIndex={0}>
          <section className="my-benefits-register" aria-label="Mis registros">
            <header className="my-benefits-register-head">
              <div>
                <span>{tab === 'TRAVEL' ? 'Movilidad y liquidaciones' : tab === 'LOAN' ? 'Financiamiento personal' : 'Descuentos programados'}</span>
                <h2>{tab === 'TRAVEL' ? 'Mis viáticos' : tab === 'LOAN' ? 'Mis préstamos' : 'Mis deducciones'}</h2>
                <p>{tab === 'TRAVEL' ? 'Consulta destino, importe aprobado y etapa de liquidación.' : tab === 'LOAN' ? 'Revisa desembolsos, saldo vigente y estado de cada solicitud.' : 'Comprueba vigencia, importe aplicable y estado oficial.'}</p>
              </div>
              <span className="my-benefits-register-count">{items.length} registro{items.length === 1 ? '' : 's'}</span>
            </header>
            <DataTable<HrTravelRequest | HrLoan | HrDeduction>
              stackOnMobile
              ariaLabel={tab === 'TRAVEL' ? 'Mis viáticos' : tab === 'LOAN' ? 'Mis préstamos' : 'Mis deducciones'}
              rows={items as Array<HrTravelRequest | HrLoan | HrDeduction>}
              rowKey={(item) => `${tab}-${item.id}`}
              pagination={{ mode: 'client' }}
              defaultPageSize={25}
              resetKey={tab}
              minWidth="44rem"
              rowTone={(item) => (selected?.resource === tab && selected.item.id === item.id ? 'primary' : undefined)}
              columns={[
                { key: 'code', header: 'Código', width: '1fr', render: (item) => <strong>{item.code}</strong> },
                {
                  key: 'detail',
                  header: 'Detalle',
                  width: '2fr',
                  render: (item) => (tab === 'TRAVEL' ? (item as HrTravelRequest).destination : tab === 'LOAN' ? (item as HrLoan).purpose : (item as HrDeduction).name),
                },
                { key: 'updatedAt', header: 'Actualizado', width: '1fr', render: (item) => dateLabel(item.updatedAt) },
                {
                  key: 'amount',
                  header: tab === 'LOAN' ? 'Saldo' : 'Importe',
                  width: '1fr',
                  type: 'money',
                  render: (item) => (
                    <strong>
                      {tab === 'TRAVEL'
                        ? money((item as HrTravelRequest).currency, (item as HrTravelRequest).approvedAmount ?? (item as HrTravelRequest).requestedAmount)
                        : tab === 'LOAN'
                          ? money((item as HrLoan).currency, (item as HrLoan).outstandingBalance)
                          : money((item as HrDeduction).currency, (item as HrDeduction).applicableAmount)}
                    </strong>
                  ),
                },
                { key: 'status', header: 'Estado', width: '1fr', type: 'status', render: (item) => <BenefitsStatusPill status={item.status} /> },
                {
                  key: 'actions',
                  header: 'Acción',
                  width: '5rem',
                  type: 'actions',
                  render: (item) => {
                    const isSelected = selected?.resource === tab && selected.item.id === item.id;
                    return (
                      <Button className="table-action-btn" size="sm" variant={isSelected ? 'secondary' : 'ghost'} onClick={() => void openDetail({ resource: tab, item } as Selected)} aria-label={`Ver detalle de ${item.code}`} title="Ver detalle"><Eye size={16} /></Button>
                    );
                  },
                },
              ]}
              empty={
                <div className="hr-benefits-empty">
                  <WalletCards size={36} />
                  <p>{tab === 'TRAVEL' ? 'Aún no tienes viáticos registrados.' : tab === 'LOAN' ? 'Aún no tienes préstamos registrados.' : 'No tienes deducciones asignadas.'}</p>
                  {tab !== 'DEDUCTION' && <Button variant="primary" size="sm" onClick={() => setPanel(tab)} disabled={!online}><Plus size={15} /> {tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'}</Button>}
                </div>
              }
            />
          </section>
          {(detailLoading || selected) && <section className="hr-benefits-workspace" aria-live="polite">
            {detailLoading ? (
              <HrLoading text="Abriendo detalle…" />
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
                    <DataTable
                      stackOnMobile
                      ariaLabel="Gastos reportados"
                      rows={selected.item.expenses ?? []}
                      rowKey={(expense) => expense.id}
                      pagination={{ mode: 'client' }}
                      minWidth="40rem"
                      empty="Aún no has reportado gastos para este viático."
                      columns={[
                        { key: 'date', header: 'Fecha', render: (expense) => dateLabel(expense.occurredOn) },
                        { key: 'description', header: 'Descripción', width: '2fr', render: (expense) => expense.description },
                        { key: 'claimed', header: 'Reclamado', type: 'money', render: (expense) => money(expense.currency, expense.claimedAmount) },
                        { key: 'recognized', header: 'Reconocido', type: 'money', render: (expense) => money(expense.currency, expense.recognizedAmount) },
                        { key: 'status', header: 'Estado', type: 'status', render: (expense) => <BenefitsStatusPill status={expense.status} /> },
                      ]}
                    />
                  </>
                )}
                {selected.resource === 'LOAN' && (
                  <>
                    <div className="hr-benefits-authority-note">
                      El calendario es informativo y autoritativo del servidor. No se recalcula en
                      tu navegador.
                    </div>
                    <h3>Calendario</h3>
                    <DataTable
                      stackOnMobile
                      ariaLabel="Calendario de cuotas"
                      rows={selected.item.schedule ?? []}
                      rowKey={(installment) => installment.id}
                      pagination={{ mode: 'client' }}
                      minWidth="44rem"
                      empty="El calendario de cuotas todavía no está publicado."
                      columns={[
                        { key: 'number', header: '#', width: '4rem', render: (installment) => installment.number },
                        { key: 'due', header: 'Vence', render: (installment) => dateLabel(installment.dueDate) },
                        { key: 'scheduled', header: 'Cuota', type: 'money', render: (installment) => money(selected.item.currency, installment.scheduledTotal) },
                        { key: 'paid', header: 'Pagado', type: 'money', render: (installment) => money(selected.item.currency, installment.paidAmount) },
                        { key: 'outstanding', header: 'Saldo', type: 'money', render: (installment) => money(selected.item.currency, installment.outstandingAmount) },
                        { key: 'status', header: 'Estado', type: 'status', render: (installment) => <BenefitsStatusPill status={installment.status} /> },
                      ]}
                    />
                    <h3>Movimientos</h3>
                    <div className="hr-benefits-ledger">
                      {(selected.item.ledger ?? []).length === 0 && (
                        <p className="hr-benefits-ledger-empty">Aún no hay movimientos registrados.</p>
                      )}
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
            ) : null}
          </section>}
        </div>
      )}
      <FullScreenModal
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
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(transition)}
        onClose={() => !saving && setTransition(null)}
        title="Confirmar acción"
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
      </FullScreenModal>
    </div>
  );
}
