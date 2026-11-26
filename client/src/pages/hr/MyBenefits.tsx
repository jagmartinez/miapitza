import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHrMoney } from '../../utils/hrDisplay';
import { Eye, Plus, RefreshCw, WalletCards } from 'lucide-react';
import {
  Button, DataTable, EmptyState, FormSection, FullScreenModal, IconButton, LoadErrorState, PageContent, PageHeader, StatCard, TableToolbar, Tabs,
} from '@/ui';
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
import form from '../../components/hr/hrForm.module.css';

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


  const selectTab = (next: typeof tab) => {
    setTab(next);
    setSelected(null);
  };

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Mi RH']}
        title="Mis viáticos y beneficios"
        description="Consulta solicitudes, saldos, cuotas y deducciones con su estado oficial"
        actions={
          <>
            {tab !== 'DEDUCTION' && (
              <Button variant="primary" icon={Plus} onClick={() => setPanel(tab)} disabled={!online}>
                {tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'}
              </Button>
            )}
            <MyHrNav />
          </>
        }
      />
      {!online && <BenefitsOnlineNotice online={false} />}
      {!loading && !error && actionableCount > 0 && (
        <section className={form.kpis} aria-label="Resumen de mis beneficios">
          <StatCard tone="warning" label="Con siguiente paso" value={String(actionableCount)} context={`Acciones permitidas por el servidor · ${closedCount} finalizado${closedCount === 1 ? '' : 's'}`} />
        </section>
      )}
      <Tabs
        ariaLabel="Mis beneficios"
        active={tab}
        onChange={(id) => selectTab(id as typeof tab)}
        tabs={[
          { id: 'TRAVEL', label: 'Viáticos', badge: travel.length },
          { id: 'LOAN', label: 'Préstamos', badge: loans.length },
          { id: 'DEDUCTION', label: 'Deducciones', badge: deductions.length },
        ]}
      />
      {!loading && error ? (
        <LoadErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className="my-benefits-register" id={activePanelId} role="tabpanel" aria-label={tab === 'TRAVEL' ? 'Mis viáticos' : tab === 'LOAN' ? 'Mis préstamos' : 'Mis deducciones'}>
          <DataTable<HrTravelRequest | HrLoan | HrDeduction>
            stackOnMobile
            ariaLabel={tab === 'TRAVEL' ? 'Mis viáticos' : tab === 'LOAN' ? 'Mis préstamos' : 'Mis deducciones'}
            rows={items as Array<HrTravelRequest | HrLoan | HrDeduction>}
            rowKey={(item) => `${tab}-${item.id}`}
            loading={loading}
            pagination={{ mode: 'client' }}
            defaultPageSize={25}
            resetKey={tab}
            minWidth="44rem"
            onRowClick={(item) => void openDetail({ resource: tab, item } as Selected)}
            toolbar={(
              <TableToolbar actions={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading || !online}>Actualizar</Button>}>
                <span className={form.help}>{tab === 'TRAVEL' ? 'Consulta destino, importe aprobado y etapa de liquidación.' : tab === 'LOAN' ? 'Revisa desembolsos, saldo vigente y estado de cada solicitud.' : 'Comprueba vigencia, importe aplicable y estado oficial.'}</span>
              </TableToolbar>
            )}
            columns={[
              { key: 'code', header: 'Código', width: '1fr', render: (item) => <span className={form.cellTitle}>{item.code}</span> },
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
                  <span className={form.cellTitle}>
                    {tab === 'TRAVEL'
                      ? money((item as HrTravelRequest).currency, (item as HrTravelRequest).approvedAmount ?? (item as HrTravelRequest).requestedAmount)
                      : tab === 'LOAN'
                        ? money((item as HrLoan).currency, (item as HrLoan).outstandingBalance)
                        : money((item as HrDeduction).currency, (item as HrDeduction).applicableAmount)}
                  </span>
                ),
              },
              { key: 'status', header: 'Estado', width: '1fr', type: 'status', render: (item) => <BenefitsStatusPill status={item.status} /> },
              {
                key: 'actions',
                header: 'Acción',
                width: '5rem',
                type: 'actions',
                render: (item) => (
                  <IconButton icon={Eye} size="sm" label={`Ver detalle de ${item.code}`} onClick={() => void openDetail({ resource: tab, item } as Selected)} />
                ),
              },
            ]}
            empty={(
              <EmptyState
                icon={WalletCards}
                title={tab === 'TRAVEL' ? 'Aún no tienes viáticos registrados.' : tab === 'LOAN' ? 'Aún no tienes préstamos registrados.' : 'No tienes deducciones asignadas.'}
                action={tab !== 'DEDUCTION' ? <Button variant="primary" size="sm" icon={Plus} onClick={() => setPanel(tab)} disabled={!online}>{tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'}</Button> : undefined}
              />
            )}
          />
        </div>
      )}

      <FullScreenModal
        isOpen={Boolean(selected) || detailLoading}
        onClose={() => setSelected(null)}
        breadcrumb={['Mi RH', 'Beneficios']}
        title={selected ? `${selected.resource === 'TRAVEL' ? 'Mi viático' : selected.resource === 'LOAN' ? 'Mi préstamo' : 'Mi deducción'} ${selected.item.code}` : 'Detalle'}
        status={selected ? <BenefitsStatusPill status={selected.item.status} /> : undefined}
        footer={selected?.resource === 'TRAVEL' ? (
          <>
            {['ADVANCED', 'IN_SETTLEMENT'].includes(selected.item.status) && (
              <Button
                variant="ghost"
                icon={Plus}
                onClick={() => {
                  expenseOperationKey.current = createBenefitsIdempotencyKey();
                  setPanel('EXPENSE');
                }}
                disabled={!online}
              >
                Agregar gasto
              </Button>
            )}
            {selected.item.allowedActions
              .filter((action): action is SelfTravelAction =>
                ['SUBMIT', 'START_SETTLEMENT', 'CANCEL'].includes(action)
              )
              .map((action) => (
                <Button
                  key={action}
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
                  <div><dt>Aprobado</dt><dd>{money(selected.item.currency, selected.item.approvedAmount)}</dd></div>
                  <div><dt>Devolución</dt><dd>{money(selected.item.currency, selected.item.employeeReturnAmount)}</dd></div>
                  <div><dt>Reembolso</dt><dd>{money(selected.item.currency, selected.item.employeeReimbursementAmount)}</dd></div>
                </>
              )}
              {selected.resource === 'LOAN' && (
                <>
                  <div><dt>Desembolsado</dt><dd>{money(selected.item.currency, selected.item.disbursedAmount)}</dd></div>
                  <div><dt>Saldo vigente</dt><dd>{money(selected.item.currency, selected.item.outstandingBalance)}</dd></div>
                  <div><dt>Cuotas</dt><dd>{selected.item.installmentCount}</dd></div>
                  <div><dt>Primera fecha</dt><dd>{dateLabel(selected.item.firstDueDate)}</dd></div>
                </>
              )}
              {selected.resource === 'DEDUCTION' && (
                <>
                  <div><dt>Aplicable</dt><dd>{money(selected.item.currency, selected.item.applicableAmount)}</dd></div>
                  <div><dt>Remanente</dt><dd>{money(selected.item.currency, selected.item.remainingAmount)}</dd></div>
                  <div><dt>Límite periodo</dt><dd>{money(selected.item.currency, selected.item.perPeriodLimit)}</dd></div>
                  <div><dt>Vigencia</dt><dd>{dateLabel(selected.item.effectiveFrom)}</dd></div>
                </>
              )}
            </dl>
            {selected.resource === 'TRAVEL' && (
              <FormSection title="Gastos reportados">
                <DataTable
                  stackOnMobile
                  ariaLabel="Gastos reportados"
                  rows={selected.item.expenses ?? []}
                  rowKey={(expense) => expense.id}
                  pagination={{ mode: 'client' }}
                  minWidth="40rem"
                  empty={<EmptyState title="Aún no has reportado gastos para este viático." />}
                  columns={[
                    { key: 'date', header: 'Fecha', render: (expense) => dateLabel(expense.occurredOn) },
                    { key: 'description', header: 'Descripción', width: '2fr', render: (expense) => expense.description },
                    { key: 'claimed', header: 'Reclamado', type: 'money', render: (expense) => money(expense.currency, expense.claimedAmount) },
                    { key: 'recognized', header: 'Reconocido', type: 'money', render: (expense) => money(expense.currency, expense.recognizedAmount) },
                    { key: 'status', header: 'Estado', type: 'status', render: (expense) => <BenefitsStatusPill status={expense.status} /> },
                  ]}
                />
              </FormSection>
            )}
            {selected.resource === 'LOAN' && (
              <>
                <p className={form.alertInfo}>
                  El calendario es informativo y autoritativo del servidor. No se recalcula en
                  tu navegador.
                </p>
                <FormSection title="Calendario">
                  <DataTable
                    stackOnMobile
                    ariaLabel="Calendario de cuotas"
                    rows={selected.item.schedule ?? []}
                    rowKey={(installment) => installment.id}
                    pagination={{ mode: 'client' }}
                    minWidth="44rem"
                    empty={<EmptyState title="El calendario de cuotas todavía no está publicado." />}
                    columns={[
                      { key: 'number', header: '#', width: '4rem', render: (installment) => installment.number },
                      { key: 'due', header: 'Vence', render: (installment) => dateLabel(installment.dueDate) },
                      { key: 'scheduled', header: 'Cuota', type: 'money', render: (installment) => money(selected.item.currency, installment.scheduledTotal) },
                      { key: 'paid', header: 'Pagado', type: 'money', render: (installment) => money(selected.item.currency, installment.paidAmount) },
                      { key: 'outstanding', header: 'Saldo', type: 'money', render: (installment) => money(selected.item.currency, installment.outstandingAmount) },
                      { key: 'status', header: 'Estado', type: 'status', render: (installment) => <BenefitsStatusPill status={installment.status} /> },
                    ]}
                  />
                </FormSection>
                <FormSection title="Movimientos">
                  {(selected.item.ledger ?? []).length === 0 ? (
                    <p className={form.help}>Aún no hay movimientos registrados.</p>
                  ) : (
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
                  )}
                </FormSection>
              </>
            )}
            {selected.resource === 'DEDUCTION' && (
              <p className={form.alertInfo}>
                Sólo se muestran deducciones asignadas a tu identidad. La nómina aplica límites,
                prioridad y vigencia de forma idempotente.
              </p>
            )}
          </div>
        ) : null}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(panel)}
        breadcrumb={['Mi RH', 'Beneficios']}
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
    </PageContent>
  );
}
