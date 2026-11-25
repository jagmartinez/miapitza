import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = read('../../pages/hr/AttendanceSettings.tsx');
const styles = read('../../pages/hr/attendance-settings.css');
const select = read('./HrReactSelect.tsx');

describe('attendance settings scope UX contract', () => {
  it('lets the operator choose a company default or an explicit branch override', () => {
    expect(settings).toContain("useState<'COMPANY' | 'BRANCH'>('COMPANY')");
    expect(settings).toContain('Regla general');
    expect(settings).toContain('Por sucursal');
    expect(settings).toContain("scopeMode === 'BRANCH'");
    expect(settings).toContain('branchId: branchId ?? null');
    expect(settings).toContain('policyPayload(policy, scopeBranchId)');
    expect(settings).toContain('isSearchable');
    expect(styles).toContain('.hr-settings-scope-mode');
  });

  it('supports explicit searchability in the shared RH select', () => {
    expect(select).toContain('isSearchable?: boolean');
    expect(select).toContain('isSearchable={isSearchable ?? options.length > 8}');
  });
});
