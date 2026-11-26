import { AppSelect, Button, Checkbox, DataTable, DateInput, FullScreenModal, Input, PageHeader, StatCard, Textarea } from '@/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  BadgeDollarSign,
  Copy,
  Eye,
  FileDown,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import HrLoading from '../../components/hr/HrLoading';
import { benefitsGovernanceClient } from '../../components/hr/benefitsGovernanceClient';
import { getBenefitsErrorMessage } from '../../components/hr/benefitsClient';
import { hrClient } from '../../components/hr/hrClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrUserSummary } from '../../types/hr';
import type {
  BenefitPolicy,
  BenefitPolicyPayload,
  EmploymentSettlement,
  SettlementExitType,
  SettlementLine,
  SettlementPayload,
  SettlementPreview,
  SettlementPreviewPayload,
  TravelPolicyCategory,
} from '../../types/hr-benefits-governance';
import './benefits-governance.css';

type Tab = 'SETTLEMENTS' | 'POLICIES';
const today = new Date().toISOString().slice(0, 10);
const categorySeed: TravelPolicyCategory[] = [
  {
    code: 'ALIMENTACION',
    name: 'Alimentación',
    dailyLimit: '500.00',
    requiresEvidence: true,
    allowedAfter: '18:00',
    allowedBefore: '07:00',
  },
  {
    code: 'HOSPEDAJE',
    name: 'Hospedaje',
    dailyLimit: '2500.00',
    requiresEvidence: true,
  },
  {
    code: 'TRANSPORTE',
    name: 'Transporte',
    dailyLimit: '1500.00',
    requiresEvidence: true,
  },
];
const emptyPolicy = (): BenefitPolicyPayload => ({
  effectiveFrom: today,
  currency: 'NIO',
  travelCategories: categorySeed.map((category) => ({ ...category })),
  travelMaxDays: 30,
  travelEvidenceRequired: true,
  loanMinTenureMonths: 6,
  loanMaxAmount: '50000.00',
  loanMaxInstallments: 24,
  loanMaxPaymentPercent: '30.00',
  sourceReference: '',
  reason: '',
});
const emptyPreview = (): SettlementPreviewPayload => ({
  userId: 0,
  terminationDate: today,
  unpaidSalaryDays: 0,
  indemnityApplicable: false,
  indemnityConfirmed: false,
});
const statusLabel: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  REVIEWED: 'Revisada',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  PAID: 'Pagada',
  VOID: 'Anulada',
  ACTIVE: 'Activa',
  RETIRED: 'Retirada',
};
const actionLabel: Record<string, string> = {
  SUBMIT: 'Enviar',
  REVIEW: 'Revisar',
  APPROVE: 'Aprobar',
  REJECT: 'Rechazar',
  REOPEN: 'Reabrir',
  PAY: 'Registrar pago',
  VOID: 'Anular',
};
const policyPayload = (
  source: BenefitPolicy,
  effectiveFrom = source.effectiveFrom.slice(0, 10)
): BenefitPolicyPayload => ({
  effectiveFrom,
  currency: source.currency,
  travelCategories: source.travelCategories.map((category) => ({ ...category })),
  travelMaxDays: source.travelMaxDays,
  travelEvidenceRequired: source.travelEvidenceRequired,
  loanMinTenureMonths: source.loanMinTenureMonths,
  loanMaxAmount: source.loanMaxAmount,
  loanMaxInstallments: source.loanMaxInstallments,
  loanMaxPaymentPercent: source.loanMaxPaymentPercent,
  sourceReference: source.sourceReference,
  reason: source.reason,
});

export default function BenefitsGovernance({ embedded = false }: { embedded?: boolean }) {
  const toast = useAppToast();
  const [tab, setTab] = useState<Tab>('SETTLEMENTS');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settlements, setSettlements] = useState<EmploymentSettlement[]>([]);
  const [search, setSearch] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [selectedSettlement, setSelectedSettlement] = useState<EmploymentSettlement | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<EmploymentSettlement | null>(null);
  const [draftSettlement, setDraftSettlement] = useState<SettlementPayload | null>(null);
  const [draftAdjustmentReason, setDraftAdjustmentReason] = useState('');
  const [draftIndemnityJustification, setDraftIndemnityJustification] = useState('');
  const [settlementAction, setSettlementAction] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionReference, setActionReference] = useState('');
  const [actionConfirmed, setActionConfirmed] = useState(false);
  const [policyToActivate, setPolicyToActivate] = useState<BenefitPolicy | null>(null);
  const [policyActivationConfirmed, setPolicyActivationConfirmed] = useState(false);
  const [policies, setPolicies] = useState<BenefitPolicy[]>([]);
  const [policyPage, setPolicyPage] = useState(1);
  const [policyStatus, setPolicyStatus] = useState('');
  const [policyPagination, setPolicyPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [users, setUsers] = useState<HrUserSummary[]>([]);
  const [showSettlement, setShowSettlement] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<BenefitPolicy | null>(null);
  const [policyAdjustmentReason, setPolicyAdjustmentReason] = useState('');
  const [previewInput, setPreviewInput] = useState<SettlementPreviewPayload>(emptyPreview);
  const [settlementMeta, setSettlementMeta] = useState({
    exitType: 'RESIGNATION' as SettlementExitType,
    cause: '',
    justification: '',
    evidence: '',
    aguinaldoPendingAmount: '',
    aguinaldoBasisReference: '',
    manualOrdinaryMonthlyBase: '',
    manualBaseReference: '',
    indemnityJustification: '',
  });
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [policy, setPolicy] = useState<BenefitPolicyPayload>(emptyPolicy);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settlementRows, policyRows, organization] = await Promise.all([
        benefitsGovernanceClient.settlements({
          search,
          status: settlementStatus || undefined,
          page,
          limit: 20,
        }),
        benefitsGovernanceClient.policies({
          status: policyStatus || undefined,
          page: policyPage,
          limit: 20,
        }),
        hrClient.getOrganization(),
      ]);
      setSettlements(settlementRows.items);
      setPagination(settlementRows.pagination);
      setPolicies(policyRows.items);
      setPolicyPagination(policyRows.pagination);
      setUsers(organization.users ?? []);
    } catch (error) {
      toast.error(
        getBenefitsErrorMessage(error, 'No se pudo cargar la administración de beneficios.')
      );
    } finally {
      setLoading(false);
    }
  }, [page, policyPage, policyStatus, search, settlementStatus, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const result = await benefitsGovernanceClient.preview({
        ...previewInput,
        ...(settlementMeta.aguinaldoPendingAmount
          ? {
              aguinaldoPendingAmount: settlementMeta.aguinaldoPendingAmount,
              aguinaldoBasisReference: settlementMeta.aguinaldoBasisReference,
            }
          : {}),
        ...(settlementMeta.manualOrdinaryMonthlyBase
          ? {
              manualOrdinaryMonthlyBase: settlementMeta.manualOrdinaryMonthlyBase,
              manualBaseReference: settlementMeta.manualBaseReference,
            }
          : {}),
        ...(previewInput.indemnityApplicable
          ? {
              indemnityConfirmed: previewInput.indemnityConfirmed,
              indemnityJustification: settlementMeta.indemnityJustification,
            }
          : {}),
      });
      setPreview(result);
    } catch (error) {
      toast.error(getBenefitsErrorMessage(error, 'No se pudo preparar la liquidación.'));
    } finally {
      setBusy(false);
    }
  };

  const createSettlement = async () => {
    if (!preview?.canSubmit) return;
    setBusy(true);
    try {
      await benefitsGovernanceClient.createSettlement({
        userId: previewInput.userId,
        exitType: settlementMeta.exitType,
        cause: settlementMeta.cause,
        justification: settlementMeta.justification,
        terminationDate: previewInput.terminationDate,
        currency: preview.currency,
        evidenceReferences: settlementMeta.evidence
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        lines: preview.suggestedLines,
        indemnityConfirmed: previewInput.indemnityConfirmed,
        indemnityJustification: settlementMeta.indemnityJustification || undefined,
      });
      toast.success('Liquidación creada como borrador.');
      setShowSettlement(false);
      setPreview(null);
      setPreviewInput(emptyPreview());
      await load();
    } catch (error) {
      toast.error(getBenefitsErrorMessage(error, 'No se pudo crear la liquidación.'));
    } finally {
      setBusy(false);
    }
  };

  const transition = async (row: EmploymentSettlement, action: string) => {
    setBusy(true);
    try {
      const updated = await benefitsGovernanceClient.transition(
        row.id,
        action.toLowerCase(),
        row.revision,
        actionReason,
        actionReference || undefined
      );
      setSelectedSettlement(updated);
      setSettlementAction(null);
      setActionReason('');
      setActionReference('');
      setActionConfirmed(false);
      toast.success('Estado actualizado.');
      await load();
    } catch (error) {
      toast.error(getBenefitsErrorMessage(error, 'No se pudo completar la acción.'));
    } finally {
      setBusy(false);
    }
  };

  const openSettlementEditor = (row: EmploymentSettlement) => {
    setEditingSettlement(row);
    setDraftSettlement({
      userId: row.userId,
      exitType: row.exitType,
      cause: row.cause,
      justification: row.justification,
      terminationDate: row.terminationDate.slice(0, 10),
      currency: row.currency,
      evidenceReferences: [...row.evidenceReferences],
      lines: row.lines.map(
        ({ type, concept, formulaBasis, sourceReference, amount: lineAmount }) => ({
          type,
          concept,
          formulaBasis,
          sourceReference,
          amount: lineAmount,
        })
      ),
      indemnityConfirmed: row.lines.some((line) => line.type === 'INDEMNITY'),
    });
    setDraftAdjustmentReason('');
    setDraftIndemnityJustification('');
  };

  const updateDraftLine = (index: number, field: keyof SettlementLine, value: string) =>
    setDraftSettlement((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line, lineIndex) =>
              lineIndex === index ? { ...line, [field]: value } : line
            ),
          }
        : current
    );

  const saveSettlementDraft = async () => {
    if (!editingSettlement || !draftSettlement) return;
    setBusy(true);
    try {
      const updated = await benefitsGovernanceClient.updateSettlement(editingSettlement.id, {
        ...draftSettlement,
        expectedRevision: editingSettlement.revision,
        adjustmentReason: draftAdjustmentReason,
        ...(draftSettlement.lines.some((line) => line.type === 'INDEMNITY')
          ? { indemnityConfirmed: true, indemnityJustification: draftIndemnityJustification }
          : {}),
      });
      toast.success('Borrador de liquidación actualizado.');
      setEditingSettlement(null);
      setDraftSettlement(null);
      setSelectedSettlement(updated);
      await load();
    } catch (error) {
      toast.error(getBenefitsErrorMessage(error, 'No se pudo actualizar el borrador.'));
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async () => {
    setBusy(true);
    try {
      if (editingPolicy) {
        await benefitsGovernanceClient.updatePolicy(editingPolicy.id, {
          ...policy,
          expectedRevision: editingPolicy.revision,
          adjustmentReason: policyAdjustmentReason,
        });
        toast.success('Borrador actualizado.');
      } else {
        await benefitsGovernanceClient.createPolicy(policy);
        toast.success('Nueva política creada como borrador.');
      }
      setShowPolicy(false);
      setEditingPolicy(null);
      setPolicyAdjustmentReason('');
      setPolicy(emptyPolicy());
      await load();
    } catch (error) {
      toast.error(
        getBenefitsErrorMessage(
          error,
          editingPolicy ? 'No se pudo actualizar el borrador.' : 'No se pudo crear la política.'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const openPolicyEditor = (source?: BenefitPolicy, clone = false) => {
    setEditingPolicy(source && !clone ? source : null);
    setPolicy(
      source
        ? policyPayload(source, clone ? today : source.effectiveFrom.slice(0, 10))
        : emptyPolicy()
    );
    setPolicyAdjustmentReason(clone && source ? `Nueva versión basada en v${source.version}` : '');
    setShowPolicy(true);
  };

  const updateCategory = (
    index: number,
    field: keyof TravelPolicyCategory,
    value: string | boolean
  ) =>
    setPolicy((current) => ({
      ...current,
      travelCategories: current.travelCategories.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));

  if (loading) return <HrLoading />;
  const activePolicy = policies.find((row) => row.status === 'ACTIVE');
  const draftSettlements = settlements.filter((row) => row.status === 'DRAFT').length;
  return (
    <div className={`benefits-governance-page${embedded ? ' is-embedded' : ''}`}>
      {!embedded && (
        <PageHeader
        title="Liquidaciones y políticas"
        description="Administra cierres laborales, viáticos y préstamos con versiones, soportes y trazabilidad."
        actions={
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw size={16} /> Actualizar
            </Button>
          }
      />
      )}
      {!embedded && (!activePolicy || draftSettlements > 0) && (
        <section className="hr-kpi-row" aria-label="Indicadores de liquidaciones y políticas">
          {!activePolicy && (
            <StatCard tone="danger" label="Política activa" value="—" context="Sin versión publicada de viáticos y préstamos." action={{ label: 'Ver políticas', onClick: () => setTab('POLICIES') }} />
          )}
          {draftSettlements > 0 && (
            <StatCard tone="warning" label="Borradores en página" value={String(draftSettlements)} context="Liquidaciones sin enviar." action={{ label: 'Ver liquidaciones', onClick: () => setTab('SETTLEMENTS') }} />
          )}
        </section>
      )}
      <nav className="governance-tabs" aria-label="Secciones" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'SETTLEMENTS'}
          className={tab === 'SETTLEMENTS' ? 'active' : ''}
          onClick={() => setTab('SETTLEMENTS')}
        >
          <BadgeDollarSign size={17} /> Liquidaciones finales
        </button>
        <button
          role="tab"
          aria-selected={tab === 'POLICIES'}
          className={tab === 'POLICIES' ? 'active' : ''}
          onClick={() => setTab('POLICIES')}
        >
          <ShieldCheck size={17} /> Políticas de viáticos y préstamos
        </button>
      </nav>

      <section
        role="tabpanel"
        aria-label={
          tab === 'SETTLEMENTS' ? 'Liquidaciones finales' : 'Políticas de viáticos y préstamos'
        }
      >
        {tab === 'SETTLEMENTS' ? (
          <>
            <div className="governance-toolbar">
              <div>
                <h2>Liquidaciones de empleados</h2>
                <p>Cada fila conserva cálculo, aprobaciones, pago y constancia PDF.</p>
              </div>
              <div className="governance-toolbar-actions">
                <Input
                  aria-label="Buscar liquidación"
                  placeholder="Buscar código o empleado"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
                <label>
                  <span>Estado</span>
                  <AppSelect<string>
                    options={[
                      { value: '', label: 'Todos' },
                      ...Object.entries(statusLabel)
                        .filter(([value]) => !['ACTIVE', 'RETIRED'].includes(value))
                        .map(([value, label]) => ({ value: String(value), label: label })),
                    ]}
                    aria-label="Filtrar liquidaciones por estado"
                    value={settlementStatus}
                    onChange={(next) => {
                      setSettlementStatus(next ?? '');
                      setPage(1);
                    }}
                    isClearable={false}
                  />
                </label>
                <Button variant="primary" onClick={() => setShowSettlement(true)}>
                  <Plus size={17} /> Nueva liquidación
                </Button>
              </div>
            </div>
            <FullScreenModal
        isOpen={showSettlement}
        onClose={() => setShowSettlement(false)}
        title="Nueva liquidación"
      >
              <section
                className="governance-form governance-sidebar-form"
                aria-label="Nueva liquidación"
              >
                <h3>1. Datos y base conciliada</h3>
                <div className="governance-grid">
                  <label>
                    Empleado
                    <AppSelect<string>
                      options={[
                        { value: String(0), label: 'Seleccione' },
                        ...users.map((user) => ({ value: String(user.id), label: user.name })),
                      ]}
                      value={String(previewInput.userId)}
                      onChange={(next) =>
                        setPreviewInput((value) => ({
                          ...value,
                          userId: Number(next ?? ''),
                        }))
                      }
                      isClearable={false}
                    />
                  </label>
                  <label>
                    Fecha de terminación
                    <DateInput
                     
                      value={previewInput.terminationDate}
                      onChange={(event) =>
                        setPreviewInput((value) => ({
                          ...value,
                          terminationDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Tipo de salida
                    <AppSelect<string>
                      options={[
                        { value: 'RESIGNATION', label: 'Renuncia' },
                        { value: 'DISMISSAL', label: 'Despido' },
                        { value: 'MUTUAL_AGREEMENT', label: 'Mutuo acuerdo' },
                        { value: 'CONTRACT_END', label: 'Fin de contrato' },
                        { value: 'OTHER', label: 'Otro' },
                      ]}
                      value={settlementMeta.exitType}
                      onChange={(next) =>
                        setSettlementMeta((value) => ({
                          ...value,
                          exitType: (next ?? '') as SettlementExitType,
                        }))
                      }
                      isClearable={false}
                    />
                  </label>
                  <label>
                    Días de salario pendientes
                    <Input
                      type="number"
                      min="0"
                      max="31"
                      value={previewInput.unpaidSalaryDays}
                      onChange={(event) =>
                        setPreviewInput((value) => ({
                          ...value,
                          unpaidSalaryDays: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Monto de aguinaldo pendiente
                    <Input
                      value={settlementMeta.aguinaldoPendingAmount}
                      onChange={(event) =>
                        setSettlementMeta((value) => ({
                          ...value,
                          aguinaldoPendingAmount: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    Referencia de conciliación aguinaldo
                    <Input
                      value={settlementMeta.aguinaldoBasisReference}
                      onChange={(event) =>
                        setSettlementMeta((value) => ({
                          ...value,
                          aguinaldoBasisReference: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Base mensual manual (solo variable/horaria)
                    <Input
                      value={settlementMeta.manualOrdinaryMonthlyBase}
                      onChange={(event) =>
                        setSettlementMeta((value) => ({
                          ...value,
                          manualOrdinaryMonthlyBase: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Referencia de base manual
                    <Input
                      value={settlementMeta.manualBaseReference}
                      onChange={(event) =>
                        setSettlementMeta((value) => ({
                          ...value,
                          manualBaseReference: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <Checkbox className="governance-check" checked={previewInput.indemnityApplicable}
                    onChange={(event) =>
                      setPreviewInput((value) => ({
                        ...value,
                        indemnityApplicable: event.target.checked,
                        indemnityConfirmed: false,
                      }))
                    } label={<>Evaluar indemnización por decisión legal expresa</>} />
                {previewInput.indemnityApplicable && (
                  <>
                    <Checkbox className="governance-check" checked={previewInput.indemnityConfirmed ?? false}
                        onChange={(event) =>
                          setPreviewInput((value) => ({
                            ...value,
                            indemnityConfirmed: event.target.checked,
                          }))
                        } label={<>Confirmo que la causal aplica</>} />
                    <label>
                      Justificación legal
                      <Textarea
                        value={settlementMeta.indemnityJustification}
                        onChange={(event) =>
                          setSettlementMeta((value) => ({
                            ...value,
                            indemnityJustification: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}
                <Button variant="primary" disabled={busy || !previewInput.userId} onClick={() => void runPreview()}>
                  Calcular vista previa
                </Button>
                {preview && (
                  <div className="preview-panel">
                    <h3>2. Resultado verificable</h3>
                    {preview.blockers.map((item) => (
                      <p className="governance-blocker" key={item}>
                        Bloqueo: {item}
                      </p>
                    ))}
                    {preview.warnings.map((item) => (
                      <p className="governance-warning" key={item}>
                        {item}
                      </p>
                    ))}
                    <DataTable
                ariaLabel="Líneas sugeridas de la liquidación"
                rows={preview.suggestedLines.map((line, index) => ({ line, index }))}
                rowKey={({ line, index }) => `${line.type}-${index}`}
                pagination={{ mode: 'client' }}
                minWidth="40rem"
                empty={'Sin registros'}
                columns={[
                  { key: 'c0', header: 'Concepto', render: ({ line }) => <>{line.concept}</> },
                  { key: 'c1', header: 'Base', render: ({ line }) => <>{line.formulaBasis}</> },
                  { key: 'c2', header: 'Fuente', render: ({ line }) => <>{line.sourceReference}</> },
                  { key: 'c3', header: 'Monto', render: ({ line }) => <>{preview.currency} {line.amount}</> },
                ]}
              />
                    {preview.canSubmit && (
                      <div className="governance-grid">
                        <label>
                          Causal
                          <Input
                            value={settlementMeta.cause}
                            onChange={(event) =>
                              setSettlementMeta((value) => ({
                                ...value,
                                cause: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Justificación operativa
                          <Input
                            value={settlementMeta.justification}
                            onChange={(event) =>
                              setSettlementMeta((value) => ({
                                ...value,
                                justification: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="span-2">
                          Soportes/referencias (uno por línea)
                          <Textarea
                            value={settlementMeta.evidence}
                            onChange={(event) =>
                              setSettlementMeta((value) => ({
                                ...value,
                                evidence: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    <Button variant="primary"
                      disabled={
                        !preview.canSubmit ||
                        !settlementMeta.cause ||
                        !settlementMeta.justification ||
                        !settlementMeta.evidence.trim() ||
                        busy
                      }
                      onClick={() => void createSettlement()}
                    >
                      Crear borrador
                    </Button>
                  </div>
                )}
              </section>
            </FullScreenModal>
            <div className="governance-table-wrap pr-table-card">
              <DataTable
                ariaLabel="Liquidaciones"
                rows={settlements}
                rowKey={(row) => row.id}
                pagination={{ mode: 'server', page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onChange: (nextPage) => setPage(nextPage) }}
                pageSizeOptions={[pagination.pageSize]}
                minWidth="48rem"
                empty={<div className="hr-admin-empty">
                          <strong>No hay liquidaciones en este filtro</strong>
                          <span>Crea una liquidación o cambia la búsqueda.</span>
                        </div>}
                columns={[
                  { key: 'c0', header: 'Código', render: (row) => <>{row.code}</> },
                  { key: 'c1', header: 'Empleado', render: (row) => (<>{row.employee.legalName}
                          <small>{row.employee.employeeCode}</small></>) },
                  { key: 'c2', header: 'Salida', render: (row) => <>{row.terminationDate.slice(0, 10)}</> },
                  { key: 'c3', header: 'Estado', render: (row) => (<span className={`governance-status ${row.status.toLowerCase()}`}>
                            {statusLabel[row.status]}
                          </span>) },
                  { key: 'c4', header: 'Neto', render: (row) => <>{row.currency} {row.netPay}</> },
                  { key: 'c5', header: 'Acciones', render: (row) => (<div className="table-actions">
                            <Button
                              className="table-action-btn"
                              size="sm"
                              variant="ghost"
                              title={`Ver y gestionar ${row.code}`}
                              aria-label={`Ver y gestionar ${row.code}`}
                              onClick={() =>
                                void benefitsGovernanceClient
                                  .settlement(row.id)
                                  .then(setSelectedSettlement)
                                  .catch((error) =>
                                    toast.error(
                                      getBenefitsErrorMessage(error, 'No se pudo abrir el detalle.')
                                    )
                                  )
                              }
                            >
                              <Eye size={16} />
                            </Button>
                            {row.status === 'DRAFT' && (
                              <Button
                                className="table-action-btn"
                                size="sm"
                                variant="ghost"
                                title={`Editar ${row.code}`}
                                aria-label={`Editar ${row.code}`}
                                onClick={() => openSettlementEditor(row)}
                              >
                                <Pencil size={16} />
                              </Button>
                            )}
                          </div>) },
                ]}
              />
            </div>
          </>
        ) : (
          <>
            <div className="governance-toolbar">
              <div>
                <h2>Políticas versionadas</h2>
                <p>Las corridas congelan la versión vigente. Una persona crea y otra activa.</p>
              </div>
              <div className="governance-toolbar-actions">
                <label>
                  <span>Estado</span>
                  <AppSelect<string>
                    options={[
                      { value: '', label: 'Todos' },
                      { value: 'DRAFT', label: 'Borrador' },
                      { value: 'ACTIVE', label: 'Activa' },
                      { value: 'RETIRED', label: 'Retirada' },
                    ]}
                    aria-label="Filtrar políticas por estado"
                    value={policyStatus}
                    onChange={(next) => {
                      setPolicyStatus(next ?? '');
                      setPolicyPage(1);
                    }}
                    isClearable={false}
                  />
                </label>
                <Button variant="primary" onClick={() => openPolicyEditor()}>
                  <Plus size={17} /> Nueva versión
                </Button>
              </div>
            </div>
            <FullScreenModal
        isOpen={showPolicy}
        onClose={() => {
                setShowPolicy(false);
                setEditingPolicy(null);
              }}
        title={
                editingPolicy
                  ? `Editar política v${editingPolicy.version}`
                  : 'Nueva política de beneficios'
              }
      >
              <section className="governance-form governance-sidebar-form">
                <h3>{editingPolicy ? 'Ajustar versión borrador' : 'Configurar nueva versión'}</h3>
                <div className="governance-grid">
                  <label>
                    Vigente desde
                    <DateInput
                     
                      min={today}
                      value={policy.effectiveFrom}
                      onChange={(event) =>
                        setPolicy((value) => ({ ...value, effectiveFrom: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Moneda
                    <Input
                      maxLength={3}
                      value={policy.currency}
                      onChange={(event) =>
                        setPolicy((value) => ({
                          ...value,
                          currency: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Máximo días de viaje
                    <Input
                      type="number"
                      value={policy.travelMaxDays}
                      onChange={(event) =>
                        setPolicy((value) => ({
                          ...value,
                          travelMaxDays: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Antigüedad mínima préstamo (meses)
                    <Input
                      type="number"
                      value={policy.loanMinTenureMonths}
                      onChange={(event) =>
                        setPolicy((value) => ({
                          ...value,
                          loanMinTenureMonths: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Tope préstamo
                    <Input
                      value={policy.loanMaxAmount}
                      onChange={(event) =>
                        setPolicy((value) => ({ ...value, loanMaxAmount: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Máximo cuotas
                    <Input
                      type="number"
                      value={policy.loanMaxInstallments}
                      onChange={(event) =>
                        setPolicy((value) => ({
                          ...value,
                          loanMaxInstallments: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Cuota máxima sobre salario (%)
                    <Input
                      value={policy.loanMaxPaymentPercent}
                      onChange={(event) =>
                        setPolicy((value) => ({
                          ...value,
                          loanMaxPaymentPercent: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fuente normativa/política
                    <Input
                      value={policy.sourceReference}
                      onChange={(event) =>
                        setPolicy((value) => ({ ...value, sourceReference: event.target.value }))
                      }
                    />
                  </label>
                  <label className="span-2">
                    Motivo de la versión
                    <Textarea
                      value={policy.reason}
                      onChange={(event) =>
                        setPolicy((value) => ({ ...value, reason: event.target.value }))
                      }
                    />
                  </label>
                  {editingPolicy && (
                    <label className="span-2">
                      Motivo del ajuste
                      <Textarea
                        value={policyAdjustmentReason}
                        onChange={(event) => setPolicyAdjustmentReason(event.target.value)}
                      />
                    </label>
                  )}
                </div>
                <Checkbox className="governance-check" checked={policy.travelEvidenceRequired}
                    onChange={(event) =>
                      setPolicy((value) => ({
                        ...value,
                        travelEvidenceRequired: event.target.checked,
                      }))
                    } label={<>Exigir soporte para todos los gastos de viático</>} />
                <h4>Categorías de viático</h4>
                <div className="governance-form-table">
                  <DataTable
                ariaLabel="Categorías de viático"
                rows={policy.travelCategories.map((category, index) => ({ category, index }))}
                rowKey={({ index }) => index}
                pagination={{ mode: 'client' }}
                minWidth="56rem"
                empty={'Sin registros'}
                columns={[
                  { key: 'c0', header: 'Código', render: ({ category, index }) => (<><Input
                              aria-label={`Código de categoría ${index + 1}`}
                              value={category.code}
                              onChange={(event) =>
                                updateCategory(index, 'code', event.target.value.toUpperCase())
                              }
                            /></>) },
                  { key: 'c1', header: 'Nombre', render: ({ category, index }) => (<><Input
                              aria-label={`Nombre de categoría ${index + 1}`}
                              value={category.name}
                              onChange={(event) =>
                                updateCategory(index, 'name', event.target.value)
                              }
                            /></>) },
                  { key: 'c2', header: 'Tope diario', render: ({ category, index }) => (<><Input
                              aria-label={`Tope diario de categoría ${index + 1}`}
                              value={category.dailyLimit}
                              onChange={(event) =>
                                updateCategory(index, 'dailyLimit', event.target.value)
                              }
                            /></>) },
                  { key: 'c3', header: 'Desde', render: ({ category, index }) => (<><Input
                              aria-label={`Hora inicial de categoría ${index + 1}`}
                              type="time"
                              value={category.allowedAfter ?? ''}
                              onChange={(event) =>
                                updateCategory(index, 'allowedAfter', event.target.value)
                              }
                            /></>) },
                  { key: 'c4', header: 'Hasta', render: ({ category, index }) => (<><Input
                              aria-label={`Hora final de categoría ${index + 1}`}
                              type="time"
                              value={category.allowedBefore ?? ''}
                              onChange={(event) =>
                                updateCategory(index, 'allowedBefore', event.target.value)
                              }
                            /></>) },
                  { key: 'c5', header: 'Soporte', render: ({ category, index }) => (<Checkbox
                              aria-label={`Exigir soporte en categoría ${index + 1}`}
                              checked={category.requiresEvidence}
                              onChange={(event) =>
                                updateCategory(index, 'requiresEvidence', event.target.checked)
                              }
                              label={<span className="sr-only">Exigir soporte</span>}
                            />) },
                  { key: 'c6', header: 'Acción', render: ({ index }) => (<Button
                              className="table-action-btn danger"
                              variant="ghost"
                              size="sm"
                              aria-label={`Eliminar categoría ${index + 1}`}
                              title="Eliminar categoría"
                              disabled={policy.travelCategories.length === 1}
                              onClick={() =>
                                setPolicy((value) => ({
                                  ...value,
                                  travelCategories: value.travelCategories.filter(
                                    (_, itemIndex) => itemIndex !== index
                                  ),
                                }))
                              }
                            >
                              <Trash2 size={15} />
                            </Button>) },
                ]}
              />
                </div>
                <div className="row-actions">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPolicy((value) => ({
                        ...value,
                        travelCategories: [
                          ...value.travelCategories,
                          { code: '', name: '', dailyLimit: '0.00', requiresEvidence: true },
                        ],
                      }))
                    }
                  >
                    <Plus size={15} /> Categoría
                  </Button>
                  <Button variant="primary"
                    disabled={
                      busy ||
                      !policy.sourceReference ||
                      !policy.reason ||
                      (Boolean(editingPolicy) && !policyAdjustmentReason.trim())
                    }
                    onClick={() => void savePolicy()}
                  >
                    {editingPolicy ? 'Guardar ajustes' : 'Guardar borrador'}
                  </Button>
                </div>
              </section>
            </FullScreenModal>
            <div className="governance-table-wrap pr-table-card">
              <DataTable
                ariaLabel="Políticas de beneficios"
                rows={policies}
                rowKey={(row) => row.id}
                pagination={{ mode: 'server', page: policyPagination.page, pageSize: policyPagination.pageSize, total: policyPagination.total, onChange: (nextPage) => setPolicyPage(nextPage) }}
                pageSizeOptions={[policyPagination.pageSize]}
                minWidth="48rem"
                empty={<div className="hr-admin-empty">
                          <strong>No hay políticas en este filtro</strong>
                          <span>Crea una versión o cambia el estado seleccionado.</span>
                        </div>}
                columns={[
                  { key: 'c0', header: 'Versión', render: (row) => (<>v{row.version}
                          <small>{row.sourceReference}</small></>) },
                  { key: 'c1', header: 'Vigencia', render: (row) => (<>{row.effectiveFrom.slice(0, 10)}
                          {row.effectiveTo ? ` — ${row.effectiveTo.slice(0, 10)}` : ''}</>) },
                  { key: 'c2', header: 'Estado', render: (row) => (<span className={`governance-status ${row.status.toLowerCase()}`}>
                            {statusLabel[row.status] ?? row.status}
                          </span>) },
                  { key: 'c3', header: 'Viáticos', render: (row) => <>{row.travelCategories.length} categorías · {row.travelMaxDays} días</> },
                  { key: 'c4', header: 'Préstamos', render: (row) => <>Tope {row.currency} {row.loanMaxAmount} · {row.loanMaxInstallments} cuotas</> },
                  { key: 'c5', header: 'Acción', render: (row) => (<div className="table-actions">
                            {row.status === 'DRAFT' && (
                              <Button
                                className="table-action-btn"
                                size="sm"
                                variant="ghost"
                                title={`Editar versión ${row.version}`}
                                aria-label={`Editar versión ${row.version}`}
                                disabled={busy}
                                onClick={() => openPolicyEditor(row)}
                              >
                                <Pencil size={16} />
                              </Button>
                            )}
                            <Button
                              className="table-action-btn"
                              size="sm"
                              variant="ghost"
                              title={`Clonar versión ${row.version}`}
                              aria-label={`Clonar versión ${row.version}`}
                              disabled={busy}
                              onClick={() => openPolicyEditor(row, true)}
                            >
                              <Copy size={16} />
                            </Button>
                            {row.status === 'DRAFT' && (
                              <Button
                                className="table-action-btn"
                                size="sm"
                                variant="ghost"
                                title={`Activar versión ${row.version}`}
                                aria-label={`Activar versión ${row.version}`}
                                disabled={busy}
                                onClick={() => {
                                  setPolicyToActivate(row);
                                  setPolicyActivationConfirmed(false);
                                }}
                              >
                                <ShieldCheck size={16} />
                              </Button>
                            )}
                          </div>) },
                ]}
              />
            </div>
          </>
        )}
      </section>
      <FullScreenModal
        isOpen={Boolean(editingSettlement && draftSettlement)}
        onClose={() => {
          setEditingSettlement(null);
          setDraftSettlement(null);
        }}
        title={editingSettlement ? `Editar ${editingSettlement.code}` : 'Editar liquidación'}
      >
        {editingSettlement && draftSettlement && (
          <section
            className="governance-form governance-sidebar-form"
            aria-label="Editar liquidación borrador"
          >
            <p className="governance-help">
              Los cambios se guardan con control de revisión. Una persona distinta deberá revisar y
              aprobar.
            </p>
            <div className="governance-grid">
              <label>
                Tipo de salida
                <AppSelect<string>
                  options={[
                    { value: 'RESIGNATION', label: 'Renuncia' },
                    { value: 'DISMISSAL', label: 'Despido' },
                    { value: 'MUTUAL_AGREEMENT', label: 'Mutuo acuerdo' },
                    { value: 'CONTRACT_END', label: 'Fin de contrato' },
                    { value: 'OTHER', label: 'Otro' },
                  ]}
                  value={draftSettlement.exitType}
                  onChange={(next) =>
                    setDraftSettlement((value) =>
                      value ? { ...value, exitType: (next ?? '') as SettlementExitType } : value
                    )
                  }
                  isClearable={false}
                />
              </label>
              <label>
                Fecha de terminación
                <DateInput
                 
                  value={draftSettlement.terminationDate}
                  onChange={(event) =>
                    setDraftSettlement((value) =>
                      value ? { ...value, terminationDate: event.target.value } : value
                    )
                  }
                />
              </label>
              <label>
                Moneda
                <Input
                  maxLength={3}
                  value={draftSettlement.currency}
                  onChange={(event) =>
                    setDraftSettlement((value) =>
                      value ? { ...value, currency: event.target.value.toUpperCase() } : value
                    )
                  }
                />
              </label>
              <label>
                Causal
                <Input
                  value={draftSettlement.cause}
                  onChange={(event) =>
                    setDraftSettlement((value) =>
                      value ? { ...value, cause: event.target.value } : value
                    )
                  }
                />
              </label>
              <label className="span-2">
                Justificación
                <Textarea
                  value={draftSettlement.justification}
                  onChange={(event) =>
                    setDraftSettlement((value) =>
                      value ? { ...value, justification: event.target.value } : value
                    )
                  }
                />
              </label>
              <label className="span-2">
                Soportes/referencias (uno por línea)
                <Textarea
                  value={draftSettlement.evidenceReferences.join('\n')}
                  onChange={(event) =>
                    setDraftSettlement((value) =>
                      value
                        ? {
                            ...value,
                            evidenceReferences: event.target.value
                              .split('\n')
                              .map((item) => item.trim())
                              .filter(Boolean),
                          }
                        : value
                    )
                  }
                />
              </label>
            </div>
            <h4>Conceptos de liquidación</h4>
            <div className="governance-form-table">
              <DataTable
                ariaLabel="Conceptos de liquidación"
                rows={draftSettlement.lines.map((line, index) => ({ line, index }))}
                rowKey={({ line, index }) => `${index}-${line.type}`}
                pagination={{ mode: 'client' }}
                minWidth="48rem"
                empty={'Sin registros'}
                columns={[
                  { key: 'c0', header: 'Tipo', render: ({ line, index }) => (<AppSelect<string>
                                                                               options={[
                                                                                 { value: 'EARNED_SALARY', label: 'Salario' },
                                                                                 { value: 'VACATION', label: 'Vacaciones' },
                                                                                 { value: 'AGUINALDO', label: 'Aguinaldo' },
                                                                                 { value: 'INDEMNITY', label: 'Indemnización' },
                                                                                 { value: 'OTHER_EARNING', label: 'Otro ingreso' },
                                                                                 { value: 'DEDUCTION', label: 'Deducción' },
                                                                               ]}
                                                                               aria-label={`Tipo de concepto ${index + 1}`}
                                                                               value={line.type}
                                                                               onChange={(next) =>
                                                                                 updateDraftLine(index, 'type', next ?? '')
                                                                               }
                                                                               isClearable={false}
                                                                             />) },
                  { key: 'c1', header: 'Concepto', render: ({ line, index }) => (<><Input
                          aria-label={`Concepto ${index + 1}`}
                          value={line.concept}
                          onChange={(event) =>
                            updateDraftLine(index, 'concept', event.target.value)
                          }
                        /></>) },
                  { key: 'c2', header: 'Base/fórmula', render: ({ line, index }) => (<><Input
                          aria-label={`Base del concepto ${index + 1}`}
                          value={line.formulaBasis}
                          onChange={(event) =>
                            updateDraftLine(index, 'formulaBasis', event.target.value)
                          }
                        /></>) },
                  { key: 'c3', header: 'Fuente', render: ({ line, index }) => (<><Input
                          aria-label={`Fuente del concepto ${index + 1}`}
                          value={line.sourceReference}
                          onChange={(event) =>
                            updateDraftLine(index, 'sourceReference', event.target.value)
                          }
                        /></>) },
                  { key: 'c4', header: 'Monto', render: ({ line, index }) => (<><Input
                          className="hr-money-input"
                          aria-label={`Monto del concepto ${index + 1}`}
                          value={line.amount}
                          onChange={(event) => updateDraftLine(index, 'amount', event.target.value)}
                        /></>) },
                  { key: 'c5', header: 'Acción', render: ({ index }) => (<Button
                          className="table-action-btn danger"
                          variant="ghost"
                          size="sm"
                          aria-label={`Eliminar concepto ${index + 1}`}
                          title="Eliminar concepto"
                          disabled={draftSettlement.lines.length === 1}
                          onClick={() =>
                            setDraftSettlement((value) =>
                              value
                                ? {
                                    ...value,
                                    lines: value.lines.filter(
                                      (_, lineIndex) => lineIndex !== index
                                    ),
                                  }
                                : value
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Button>) },
                ]}
              />
            </div>
            <div className="row-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  setDraftSettlement((value) =>
                    value
                      ? {
                          ...value,
                          lines: [
                            ...value.lines,
                            {
                              type: 'OTHER_EARNING',
                              concept: '',
                              formulaBasis: '',
                              sourceReference: '',
                              amount: '0.00',
                            },
                          ],
                        }
                      : value
                  )
                }
              >
                <Plus size={15} /> Concepto
              </Button>
            </div>
            {draftSettlement.lines.some((line) => line.type === 'INDEMNITY') && (
              <label>
                Justificación legal de indemnización
                <Textarea
                  value={draftIndemnityJustification}
                  onChange={(event) => setDraftIndemnityJustification(event.target.value)}
                />
              </label>
            )}
            <label>
              Motivo del ajuste
              <Textarea
                value={draftAdjustmentReason}
                onChange={(event) => setDraftAdjustmentReason(event.target.value)}
              />
            </label>
            <div className="row-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingSettlement(null);
                  setDraftSettlement(null);
                }}
              >
                Cancelar
              </Button>
              <Button variant="primary"
                disabled={
                  busy ||
                  !draftAdjustmentReason.trim() ||
                  !draftSettlement.cause.trim() ||
                  !draftSettlement.justification.trim() ||
                  draftSettlement.evidenceReferences.length === 0 ||
                  (draftSettlement.lines.some((line) => line.type === 'INDEMNITY') &&
                    !draftIndemnityJustification.trim())
                }
                onClick={() => void saveSettlementDraft()}
              >
                Guardar ajustes
              </Button>
            </div>
          </section>
        )}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(selectedSettlement)}
        onClose={() => {
          setSelectedSettlement(null);
          setSettlementAction(null);
        }}
        title={selectedSettlement ? `Liquidación ${selectedSettlement.code}` : 'Liquidación'}
      >
        {selectedSettlement && (
          <div className="governance-detail">
            <div className="governance-detail-head">
              <div>
                <strong>{selectedSettlement.employee.legalName}</strong>
                <span>
                  {selectedSettlement.employee.employeeCode} · salida{' '}
                  {selectedSettlement.terminationDate.slice(0, 10)}
                </span>
              </div>
              <span className={`governance-status ${selectedSettlement.status.toLowerCase()}`}>
                {statusLabel[selectedSettlement.status]}
              </span>
            </div>
            <p>
              <strong>Causal:</strong> {selectedSettlement.cause}
            </p>
            <p>
              <strong>Justificación:</strong> {selectedSettlement.justification}
            </p>
            <DataTable
                ariaLabel="Conceptos de la liquidación seleccionada"
                rows={selectedSettlement.lines.map((line, index) => ({ line, index }))}
                rowKey={({ line, index }) => `${line.type}-${index}`}
                pagination={{ mode: 'client' }}
                minWidth="40rem"
                empty={'Sin registros'}
                columns={[
                  { key: 'c0', header: 'Concepto', render: ({ line }) => <>{line.concept}</> },
                  { key: 'c1', header: 'Base/fuente', render: ({ line }) => (<>{line.formulaBasis}
                      <small>{line.sourceReference}</small></>) },
                  { key: 'c2', header: 'Monto', render: ({ line }) => <>{selectedSettlement.currency} {line.amount}</> },
                ]}
              />
            <div className="governance-total">
              <span>Neto a pagar</span>
              <strong>
                {selectedSettlement.currency} {selectedSettlement.netPay}
              </strong>
            </div>
            <h4>Soportes y referencias</h4>
            <ul>
              {selectedSettlement.evidenceReferences.map((reference) => (
                <li key={reference}>{reference}</li>
              ))}
            </ul>
            {settlementAction ? (
              <div className="governance-action-form">
                <h4>{actionLabel[settlementAction] ?? settlementAction}</h4>
                <label>
                  Motivo
                  <Textarea
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                  />
                </label>
                {['PAY', 'VOID'].includes(settlementAction) && (
                  <label>
                    Referencia documental/financiera
                    <Input
                      value={actionReference}
                      onChange={(event) => setActionReference(event.target.value)}
                    />
                  </label>
                )}
                <Checkbox className="governance-check" checked={actionConfirmed}
                    onChange={(event) => setActionConfirmed(event.target.checked)} label={<>Confirmo esta decisión y su efecto en el expediente</>} />
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSettlementAction(null);
                      setActionReason('');
                      setActionReference('');
                      setActionConfirmed(false);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button variant="primary"
                    disabled={
                      busy ||
                      !actionConfirmed ||
                      !actionReason.trim() ||
                      (['PAY', 'VOID'].includes(settlementAction) && !actionReference.trim())
                    }
                    onClick={() => void transition(selectedSettlement, settlementAction)}
                  >
                    Continuar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="row-actions">
                {selectedSettlement.allowedActions.map((action) => (
                  <Button
                    size="sm"
                    variant={['REJECT', 'VOID'].includes(action) ? 'danger' : 'secondary'}
                    key={action}
                    disabled={busy}
                    onClick={() => {
                      setSettlementAction(action);
                      setActionReason('');
                      setActionReference('');
                      setActionConfirmed(false);
                    }}
                  >
                    {actionLabel[action] ?? action}
                  </Button>
                ))}
                {['APPROVED', 'PAID'].includes(selectedSettlement.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void benefitsGovernanceClient.downloadPdf(
                        selectedSettlement.id,
                        selectedSettlement.code
                      )
                    }
                  >
                    <FileDown size={15} /> PDF
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(policyToActivate)}
        onClose={() => setPolicyToActivate(null)}
        title="Activar política"
        size="compact"
      >
        {policyToActivate && (
          <div className="governance-detail">
            <p>
              La versión <strong>v{policyToActivate.version}</strong> entrará en vigencia el{' '}
              <strong>{policyToActivate.effectiveFrom.slice(0, 10)}</strong>. La política publicada
              anterior se cerrará el día previo, sin alterar corridas históricas.
            </p>
            <p>Por segregación de funciones, quien creó esta versión no puede activarla.</p>
            <Checkbox className="governance-check" checked={policyActivationConfirmed}
                onChange={(event) => setPolicyActivationConfirmed(event.target.checked)} label={<>Confirmo que revisé vigencia, topes, categorías y fuente</>} />
            <div className="row-actions">
              <Button variant="ghost" onClick={() => setPolicyToActivate(null)}>
                Cancelar
              </Button>
              <Button variant="primary"
                disabled={busy || !policyActivationConfirmed}
                onClick={() => {
                  setBusy(true);
                  void benefitsGovernanceClient
                    .activatePolicy(
                      policyToActivate.id,
                      policyToActivate.revision,
                      policyActivationConfirmed
                    )
                    .then(async () => {
                      toast.success('Política publicada.');
                      setPolicyToActivate(null);
                      await load();
                    })
                    .catch((error) =>
                      toast.error(getBenefitsErrorMessage(error, 'No se pudo activar.'))
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Activar versión
              </Button>
            </div>
          </div>
        )}
      </FullScreenModal>
    </div>
  );
}
