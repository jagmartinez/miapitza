import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = read('../../pages/hr/AttendanceSettings.tsx');
// Layout migrado: el alcance usa SegmentedControl de @/ui (antes .hr-settings-scope-mode en attendance-settings.css).

describe('attendance settings scope UX contract', () => {
  it('lets the operator choose a company default or an explicit branch override', () => {
    expect(settings).toContain("useState<'COMPANY' | 'BRANCH'>('COMPANY')");
    expect(settings).toContain('Regla general');
    expect(settings).toContain('Por sucursal');
    expect(settings).toContain("scopeMode === 'BRANCH'");
    expect(settings).toContain('branchId: branchId ?? null');
    expect(settings).toContain('policyPayload(policy, scopeBranchId)');
    expect(settings).toContain('<AppSelect<string>');
    expect(settings).toContain('<SegmentedControl');
  });
});
