import { DataTable, AppSelect, Button } from '@/ui';
import { useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Power, Save, X } from 'lucide-react';
import type { HrPayrollPaymentConceptDefinition } from '../../types/hr-payroll';

interface Props {
  concepts: HrPayrollPaymentConceptDefinition[];
  onChange: (concepts: HrPayrollPaymentConceptDefinition[]) => void;
}

const emptyConcept = (): HrPayrollPaymentConceptDefinition => ({
  active: true,
  code: '',
  name: '',
  type: 'INCOME',
  socialSecurityApplicable: false,
  trainingContributionApplicable: false,
  incomeTaxTreatment: null,
  incomeTaxDeductible: false,
  sourceReference: '',
});

const taxLabel = (concept: HrPayrollPaymentConceptDefinition) => concept.type === 'DEDUCTION'
  ? concept.incomeTaxDeductible ? 'Deducción autorizada' : 'No deducible'
  : concept.incomeTaxTreatment === 'REGULAR_FIXED' ? 'Ordinario fijo'
    : concept.incomeTaxTreatment === 'REGULAR_VARIABLE' ? 'Ordinario variable'
      : concept.incomeTaxTreatment === 'OCCASIONAL' ? 'Ocasional' : 'No sujeto';

export default function PayrollPaymentConceptCatalogEditor({ concepts, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<HrPayrollPaymentConceptDefinition | null>(null);
  const activeCount = useMemo(() => concepts.filter((concept) => concept.active).length, [concepts]);

  const startAdd = () => {
    setEditingIndex(-1);
    setDraft(emptyConcept());
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraft({ ...concepts[index] });
  };

  const cancel = () => {
    setEditingIndex(null);
    setDraft(null);
  };

  const updateDraft = (patch: Partial<HrPayrollPaymentConceptDefinition>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  const changeType = (type: HrPayrollPaymentConceptDefinition['type']) => {
    updateDraft(type === 'INCOME'
      ? { type, incomeTaxDeductible: false }
      : { type, socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null });
  };

  const codeIsUnique = draft
    ? !concepts.some((concept, index) => concept.code === draft.code && index !== editingIndex)
    : false;
  const draftReady = Boolean(
    draft && /^[A-Z0-9_]{2,64}$/.test(draft.code) && draft.name.trim().length >= 2 &&
    draft.sourceReference.trim().length >= 3 && codeIsUnique
  );

  const save = () => {
    if (!draft || !draftReady || editingIndex === null) return;
    const normalized = { ...draft, name: draft.name.trim(), sourceReference: draft.sourceReference.trim() };
    onChange(editingIndex === -1
      ? [...concepts, normalized]
      : concepts.map((concept, index) => index === editingIndex ? normalized : concept));
    cancel();
  };

  const toggleActive = (index: number) => {
    onChange(concepts.map((concept, position) => position === index
      ? { ...concept, active: !concept.active }
      : concept));
  };

  return (
    <section className="span-full hr-legal-concepts" aria-labelledby="payment-concept-catalog-title">
      <div className="hr-legal-tax-table-heading">
        <div>
          <strong id="payment-concept-catalog-title">Conceptos de pago</strong>
          <small>{activeCount} activos de {concepts.length}. Inhabilitar conserva el histórico y evita usar el concepto en nuevas corridas.</small>
        </div>
        <Button variant="primary" type="button" size="sm" onClick={startAdd} disabled={draft !== null}>
          <Plus size={16} aria-hidden="true" /> Nuevo concepto
        </Button>
      </div>

      {draft && (
        <div className="hr-legal-concept-editor" role="group" aria-label={editingIndex === -1 ? 'Nuevo concepto de pago' : `Editar ${draft.name}`}>
          <div className="hr-legal-concept-editor-heading">
            <div><strong>{editingIndex === -1 ? 'Agregar concepto' : 'Editar concepto'}</strong><small>Define una vez su tratamiento legal. La corrida solo podrá elegir códigos activos.</small></div>
            <Button type="button" size="sm" variant="ghost" onClick={cancel} aria-label="Cerrar editor"><X size={16} /></Button>
          </div>
          <div className="hr-legal-concept-fields">
            <label>Código<input value={draft.code} maxLength={64} onChange={(event) => updateDraft({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} disabled={editingIndex !== -1} required /><small>{!codeIsUnique ? 'Ese código ya existe.' : 'No cambia después de crear el concepto.'}</small></label>
            <label>Nombre<input value={draft.name} maxLength={160} onChange={(event) => updateDraft({ name: event.target.value })} required /></label>
            <label>Tipo<AppSelect<string>
                         options={[
                           { value: 'INCOME', label: 'Ingreso' },
                           { value: 'DEDUCTION', label: 'Deducción' },
                         ]}
                         value={draft.type}
                         onChange={(next) =>
                           changeType((next ?? '') as HrPayrollPaymentConceptDefinition['type'])
                         }
                         isClearable={false}
                       /></label>
            {draft.type === 'INCOME' ? <>
              <label>IR laboral<AppSelect<string>
                                 options={[
                                   { value: 'NONE', label: 'No sujeto' },
                                   { value: 'REGULAR_FIXED', label: 'Ordinario fijo' },
                                   { value: 'REGULAR_VARIABLE', label: 'Ordinario variable' },
                                   { value: 'OCCASIONAL', label: 'Ocasional' },
                                 ]}
                                 value={draft.incomeTaxTreatment ?? 'NONE'}
                                 onChange={(next) =>
                                   updateDraft({
                                     incomeTaxTreatment:
                                       (next ?? '') === 'NONE'
                                         ? null
                                         : ((next ??
                                             '') as HrPayrollPaymentConceptDefinition['incomeTaxTreatment']),
                                   })
                                 }
                                 isClearable={false}
                               /></label>
              <label className="hr-legal-switch"><input type="checkbox" checked={draft.socialSecurityApplicable} onChange={(event) => updateDraft({ socialSecurityApplicable: event.target.checked })} /><span>Forma base de INSS</span></label>
              <label className="hr-legal-switch"><input type="checkbox" checked={draft.trainingContributionApplicable} onChange={(event) => updateDraft({ trainingContributionApplicable: event.target.checked })} /><span>Forma base de INATEC</span></label>
            </> : <label className="hr-legal-switch"><input type="checkbox" checked={draft.incomeTaxDeductible} onChange={(event) => updateDraft({ incomeTaxDeductible: event.target.checked })} /><span>Deducción autorizada para IR</span></label>}
            <label className="span-full">Fuente o respaldo<input value={draft.sourceReference} maxLength={500} onChange={(event) => updateDraft({ sourceReference: event.target.value })} required /></label>
          </div>
          <div className="hr-legal-concept-editor-actions"><Button type="button" variant="ghost" onClick={cancel}>Cancelar</Button><Button variant="primary" type="button" onClick={save} disabled={!draftReady}><Save size={16} /> Guardar concepto</Button></div>
        </div>
      )}

      <div className="hr-legal-readonly-table-wrap hr-legal-concept-table-wrap">
        <DataTable
                ariaLabel="Catálogo de conceptos de pago"
                rows={concepts.map((concept, index) => ({ concept, index }))}
                rowKey={({ concept }) => concept.code}
                pagination={{ mode: 'client' }}
                minWidth="56rem"
                empty={'Sin registros'}
                columns={[
                  { key: 'c0', header: 'Concepto', render: ({ concept }) => <><strong>{concept.name}</strong><small>{concept.code}</small></> },
                  { key: 'c1', header: 'Tipo', render: ({ concept }) => <>{concept.type === 'INCOME' ? 'Ingreso' : 'Deducción'}</> },
                  { key: 'c2', header: 'IR laboral', render: ({ concept }) => <>{taxLabel(concept)}</> },
                  { key: 'c3', header: 'INSS', render: ({ concept }) => <>{concept.type === 'INCOME' && concept.socialSecurityApplicable ? 'Sí' : 'No'}</> },
                  { key: 'c4', header: 'INATEC', render: ({ concept }) => <>{concept.type === 'INCOME' && concept.trainingContributionApplicable ? 'Sí' : 'No'}</> },
                  { key: 'c5', header: 'Estado', render: ({ concept }) => <span className={`hr-legal-status ${concept.active ? 'is-active' : 'is-inactive'}`}>{concept.active ? <CheckCircle2 size={14} /> : <Power size={14} />}{concept.active ? 'Activo' : 'Inhabilitado'}</span> },
                  { key: 'c6', header: 'Acciones', render: ({ concept, index }) => <div className="hr-legal-row-actions"><Button type="button" size="sm" variant="ghost" onClick={() => startEdit(index)} disabled={draft !== null}><Pencil size={15} /> Editar</Button><Button type="button" size="sm" variant="ghost" onClick={() => toggleActive(index)} disabled={draft !== null}><Power size={15} /> {concept.active ? 'Inhabilitar' : 'Activar'}</Button></div> },
                ]}
              />
      </div>
    </section>
  );
}
