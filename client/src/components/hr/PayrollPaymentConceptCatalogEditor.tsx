import HrReactSelect from './HrReactSelect';
import { Plus, Trash2 } from 'lucide-react';
import Button from '../Button';
import type { HrPayrollPaymentConceptDefinition } from '../../types/hr-payroll';

interface Props {
  concepts: HrPayrollPaymentConceptDefinition[];
  onChange: (concepts: HrPayrollPaymentConceptDefinition[]) => void;
}

const emptyConcept = (): HrPayrollPaymentConceptDefinition => ({
  code: '',
  name: '',
  type: 'INCOME',
  socialSecurityApplicable: false,
  trainingContributionApplicable: false,
  incomeTaxTreatment: null,
  incomeTaxDeductible: false,
  sourceReference: '',
});

export default function PayrollPaymentConceptCatalogEditor({ concepts, onChange }: Props) {
  const update = (index: number, patch: Partial<HrPayrollPaymentConceptDefinition>) => {
    onChange(concepts.map((concept, position) => position === index ? { ...concept, ...patch } : concept));
  };

  const changeType = (index: number, type: HrPayrollPaymentConceptDefinition['type']) => {
    update(index, type === 'INCOME'
      ? { type, incomeTaxDeductible: false }
      : { type, socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null });
  };

  return (
    <section className="span-full hr-payroll-tax-table" aria-labelledby="payment-concept-catalog-title">
      <div className="hr-payroll-form-actions">
        <div>
          <strong id="payment-concept-catalog-title">Catálogo paramétrico de conceptos de pago</strong>
          <p className="hr-payroll-help">Cada código se clasifica una sola vez. El cálculo usa estas banderas congeladas, nunca el nombre del concepto.</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...concepts, emptyConcept()])}>
          <Plus size={16} aria-hidden="true" /> Agregar concepto
        </Button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Código y nombre</th><th>Tipo</th><th>INSS</th><th>INATEC</th><th>IR laboral</th><th>Fuente</th><th>Acción</th></tr></thead>
          <tbody>
            {concepts.map((concept, index) => (
              <tr key={`${concept.code}-${index}`}>
                <td>
                  <input aria-label={`Código concepto ${index + 1}`} value={concept.code} maxLength={64} onChange={(event) => update(index, { code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} required />
                  <input aria-label={`Nombre concepto ${index + 1}`} value={concept.name} maxLength={160} onChange={(event) => update(index, { name: event.target.value })} required />
                </td>
                <td><HrReactSelect value={concept.type} onChange={(event) => changeType(index, event.target.value as HrPayrollPaymentConceptDefinition['type'])}><option value="INCOME">Ingreso</option><option value="DEDUCTION">Deducción</option></HrReactSelect></td>
                <td><input aria-label={`Aplica INSS ${concept.code || index + 1}`} type="checkbox" checked={concept.socialSecurityApplicable} disabled={concept.type !== 'INCOME'} onChange={(event) => update(index, { socialSecurityApplicable: event.target.checked })} /></td>
                <td><input aria-label={`Aplica INATEC ${concept.code || index + 1}`} type="checkbox" checked={concept.trainingContributionApplicable} disabled={concept.type !== 'INCOME'} onChange={(event) => update(index, { trainingContributionApplicable: event.target.checked })} /></td>
                <td>{concept.type === 'INCOME' ? <HrReactSelect aria-label={`Tratamiento IR ${concept.code || index + 1}`} value={concept.incomeTaxTreatment ?? 'NONE'} onChange={(event) => update(index, { incomeTaxTreatment: event.target.value === 'NONE' ? null : event.target.value as HrPayrollPaymentConceptDefinition['incomeTaxTreatment'] })}><option value="NONE">No sujeto</option><option value="REGULAR_FIXED">Ordinario fijo</option><option value="REGULAR_VARIABLE">Ordinario variable</option><option value="OCCASIONAL">Ocasional</option></HrReactSelect> : <label><input type="checkbox" checked={concept.incomeTaxDeductible} onChange={(event) => update(index, { incomeTaxDeductible: event.target.checked })} /> Deducción IR autorizada</label>}</td>
                <td><input aria-label={`Fuente concepto ${concept.code || index + 1}`} value={concept.sourceReference} maxLength={500} onChange={(event) => update(index, { sourceReference: event.target.value })} required /></td>
                <td><Button type="button" size="sm" variant="danger" aria-label={`Eliminar ${concept.code || `concepto ${index + 1}`}`} onClick={() => onChange(concepts.filter((_, position) => position !== index))}><Trash2 size={15} aria-hidden="true" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
