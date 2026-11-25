import { describe, expect, it } from 'vitest';
import { benefitsTone, hrEmploymentTone, payrollTone, scheduleTone, workforceTone } from './statusTone';

describe('hr statusTone', () => {
  it('conserva los tonos de las antiguas pastillas', () => {
    expect(hrEmploymentTone('ACTIVE')).toBe('success');
    expect(hrEmploymentTone('ON_LEAVE')).toBe('warning');
    expect(hrEmploymentTone('TERMINATED')).toBe('danger');
    expect(hrEmploymentTone('INACTIVE')).toBe('neutral');
    expect(payrollTone('PAID')).toBe('success');
    expect(payrollTone('BLOCKING')).toBe('danger');
    expect(payrollTone('REVIEW')).toBe('warning');
    expect(payrollTone('CLOSED')).toBe('neutral');
    expect(workforceTone('CRITICAL')).toBe('danger');
    expect(workforceTone('PENDING')).toBe('warning');
    expect(workforceTone('DRAFT')).toBe('neutral');
    expect(scheduleTone('PUBLISHED')).toBe('success');
    expect(scheduleTone('SUPERSEDED')).toBe('warning');
    expect(benefitsTone('SETTLED')).toBe('success');
    expect(benefitsTone('REVERSED')).toBe('danger');
    expect(benefitsTone('COMPLETED')).toBe('neutral');
    expect(benefitsTone('PENDING')).toBe('warning');
  });
});
