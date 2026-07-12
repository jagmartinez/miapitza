import { describe, expect, it } from 'vitest';
import { getCateringStatusOptions, isCateringStatusTerminal } from './cateringStatus';

describe('catering status UI', () => {
    it('uses payment as the only path from reserved to paid', () => {
        expect(getCateringStatusOptions('RESERVED')).toEqual(['RESERVED', 'CANCELLED']);
        expect(getCateringStatusOptions('RESERVED')).not.toContain('PAID');
    });

    it('only offers finish after payment', () => {
        expect(getCateringStatusOptions('QUOTED')).not.toContain('FINISHED');
        expect(getCateringStatusOptions('PAID')).toEqual(['PAID', 'FINISHED']);
    });

    it('keeps terminal states non-editable', () => {
        expect(isCateringStatusTerminal('FINISHED')).toBe(true);
        expect(isCateringStatusTerminal('CANCELLED')).toBe(true);
        expect(getCateringStatusOptions('FINISHED')).toEqual(['FINISHED']);
    });
});
