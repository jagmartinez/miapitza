import { describe, expect, it } from '@jest/globals';

import { containsOnlyKnownExternalTableRemovals } from '../../utils/schema-drift';

describe('schema drift external ownership boundary', () => {
    it('accepts the biometric provider table as an intentional external table', () => {
        expect(containsOnlyKnownExternalTableRemovals(`
[-] Removed tables
  - face_templates
`)).toBe(true);
    });

    it('does not hide an additional removed application table', () => {
        expect(containsOnlyKnownExternalTableRemovals(`
[-] Removed tables
  - face_templates
  - Payment
`)).toBe(false);
    });

    it('does not hide any other kind of schema drift', () => {
        expect(containsOnlyKnownExternalTableRemovals(`
[+] Added columns
  - Payment.settlementWarehouseId
`)).toBe(false);
    });
});
