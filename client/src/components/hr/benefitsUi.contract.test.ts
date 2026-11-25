import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const owner = readFileSync(
  new URL('../../pages/hr/BenefitsManagement.tsx', import.meta.url),
  'utf8'
);
const self = readFileSync(new URL('../../pages/hr/MyBenefits.tsx', import.meta.url), 'utf8');
const transition = readFileSync(new URL('./BenefitsTransitionForm.tsx', import.meta.url), 'utf8');
const travel = readFileSync(new URL('./TravelRequestForm.tsx', import.meta.url), 'utf8');
const loan = readFileSync(new URL('./LoanRequestForm.tsx', import.meta.url), 'utf8');
const deduction = readFileSync(new URL('./DeductionForm.tsx', import.meta.url), 'utf8');
const expense = readFileSync(new URL('./TravelExpenseForm.tsx', import.meta.url), 'utf8');
const governance = readFileSync(
  new URL('../../pages/hr/BenefitsGovernance.tsx', import.meta.url),
  'utf8'
);
const governanceClient = readFileSync(new URL('./benefitsGovernanceClient.ts', import.meta.url), 'utf8');
const benefitsStyles = readFileSync(new URL('../../pages/hr/benefits.css', import.meta.url), 'utf8');
const hrUiStyles = readFileSync(new URL('../../pages/hr/hr-ui.css', import.meta.url), 'utf8');

describe('Phase 6 benefits UI contract', () => {
  it('exposes all Owner workspaces and server-authored detail', () => {
    [
      'Viáticos',
      'Préstamos',
      'Deducciones',
      'Gastos y soportes',
      'Calendario informativo del servidor',
      'Ledger',
      'Trazabilidad',
    ].forEach((label) => expect(owner).toContain(label));
    expect(owner).toContain('allowedActions.map');
    expect(owner).toContain('createBenefitsIdempotencyKey()');
    expect(owner).toContain('STATUS_OPTIONS[tab].map');
    expect(owner).toContain('className="hr-admin-table inventory-table"');
    expect(owner).toContain('className="hr-benefits-admin-register"');
    expect(owner).toContain('placeholder="Código, empleado o detalle"');
    expect(owner).toContain('filteredCards');
    expect(owner).toContain('Ver y gestionar');
    expect(owner).not.toContain('className="hr-benefits-list"');
    expect(owner).toContain('collectAllPages');
  });

  it('uses accessible label-free filters and right-aligned financial values', () => {
    expect(owner).toContain('<span className="sr-only">Buscar</span>');
    expect(owner).toContain('aria-label="Buscar por código, empleado o detalle"');
    expect(owner).toContain('<span className="sr-only">Estado</span>');
    expect(owner).toContain('aria-label="Filtrar por estado"');
    expect(benefitsStyles).toContain('minmax(480px, 1.25fr)');
    expect(benefitsStyles).toContain(':is(th, td).hr-amount-cell');
    expect(hrUiStyles).toContain(':is(td, th).hr-amount-cell');
  });

  it('keeps policies and settlement drafts administrable without native prompts', () => {
    expect(governance).toContain('openPolicyEditor(row)');
    expect(governance).toContain('openPolicyEditor(row, true)');
    expect(governance).toContain('openSettlementEditor(row)');
    expect(governance).toContain('governance-sidebar-form');
    expect(governance).toContain('expectedRevision: editingPolicy.revision');
    expect(governance).toContain('expectedRevision: editingSettlement.revision');
    expect(governanceClient).toContain('updatePolicy');
    expect(governanceClient).toContain('updateSettlement');
    expect(governance).not.toContain('window.prompt');
    expect(governance).not.toContain('<select');
  });

  it('limits self-service to own endpoints and allowed travel actions', () => {
    expect(self).toContain('getMyTravelRequests');
    expect(self).toContain('getMyLoans');
    expect(self).toContain('getMyDeductions');
    expect(self).toContain("['SUBMIT', 'START_SETTLEMENT', 'CANCEL']");
    expect(self).not.toContain('transitionDeduction(');
    expect(self).not.toContain('transitionLoan(');
  });

  it('presents personal benefits as a full-width paginated register', () => {
    expect(self).toContain('className="my-benefits-register"');
    expect(self).toContain('inventory-table my-benefits-table');
    expect(self).toContain('<Pagination');
    expect(self).toContain('className="hr-amount-cell"');
    expect(self).not.toContain('className="hr-benefits-list"');
  });

  it('requires explicit confirmation and explains server authority', () => {
    [transition, travel, loan, deduction].forEach((source) => {
      expect(source).toContain('checked={confirmed}');
      expect(source).toContain('!confirmed');
    });
    expect(transition).toContain('se validan en servidor');
    expect(loan).toContain('calendario final y sus cuotas se calculan en el servidor');
    expect(deduction).toMatch(/El servidor decide monto\s+aplicable/);
  });

  it('uses the canonical RH modal shell for financial forms and governance panels', () => {
    [transition, travel, loan, deduction, expense].forEach((source) => {
      expect(source).toContain('HrModalFormShell');
    });
    expect(governance).toContain('premium-modal-content governance-form governance-sidebar-form');
    expect(governance).toContain('premium-modal-content governance-detail');
  });

  it('keeps one idempotency key across ambiguous expense retries', () => {
    [owner, self].forEach((source) => {
      expect(source).toContain('const expenseOperationKey = useRef<string | null>(null)');
      expect(source).toContain('expenseOperationKey.current ?? createBenefitsIdempotencyKey()');
      expect(source).toContain('expenseOperationKey.current = idempotencyKey');
    });
  });
});
