import { describe, expect, it } from '@jest/globals';
import type { CateringStatus } from '@prisma/client';
import { CATERING_STATUS_TRANSITIONS } from '../../services/catering.service';

describe('catering status machine', () => {
    const valid: Array<[CateringStatus, CateringStatus]> = [
        ['QUOTED', 'RESERVED'],
        ['QUOTED', 'CANCELLED'],
        ['RESERVED', 'CANCELLED'],
        ['PAID', 'FINISHED'],
    ];

    it.each(valid)('allows %s -> %s', (from, to) => {
        expect(CATERING_STATUS_TRANSITIONS[from]).toContain(to);
    });

    it('contains only real Prisma/UI statuses and no dead intermediate states', () => {
        const real = new Set<CateringStatus>(['QUOTED', 'RESERVED', 'PAID', 'FINISHED', 'CANCELLED']);
        for (const [from, targets] of Object.entries(CATERING_STATUS_TRANSITIONS)) {
            expect(real.has(from as CateringStatus)).toBe(true);
            for (const target of targets) expect(real.has(target)).toBe(true);
        }
        expect(Object.keys(CATERING_STATUS_TRANSITIONS)).not.toContain('CONFIRMED');
        expect(Object.keys(CATERING_STATUS_TRANSITIONS)).not.toContain('IN_PROGRESS');
    });

    it.each([
        ['QUOTED', 'PAID'], ['QUOTED', 'FINISHED'], ['RESERVED', 'FINISHED'],
        ['RESERVED', 'PAID'], ['PAID', 'CANCELLED'], ['FINISHED', 'CANCELLED'],
        ['CANCELLED', 'RESERVED'],
    ] as Array<[CateringStatus, CateringStatus]>)('rejects manual %s -> %s', (from, to) => {
        expect(CATERING_STATUS_TRANSITIONS[from]).not.toContain(to);
    });
});
