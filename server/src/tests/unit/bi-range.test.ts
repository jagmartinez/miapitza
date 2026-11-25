import { describe, expect, it } from '@jest/globals';
import { bucketKey, buckets, resolveBiRange, type BiQuery } from '../../services/bi/bi-range';

const TZ = 'America/Managua';
const base: BiQuery = { companyId: 1, branchIds: [], period: '30d', compare: 'previous' };

describe('resolveBiRange', () => {
    it('today in Managua starts at local midnight', () => {
        const r = resolveBiRange({ ...base, period: 'today' }, new Date('2026-11-20T02:00:00Z'), TZ);
        expect(r.from.toISOString()).toBe('2026-11-19T06:00:00.000Z');
        expect(r.to.toISOString()).toBe('2026-11-20T06:00:00.000Z');
        expect(r.granularity).toBe('hour');
        expect(buckets(r)).toHaveLength(24);
    });

    it('30d yields 30 daily buckets and previous ends where the range starts', () => {
        const r = resolveBiRange(base, new Date('2026-11-20T15:00:00Z'), TZ);
        expect(r.granularity).toBe('day');
        expect(buckets(r)).toHaveLength(30);
        expect(r.days).toBe(30);
        expect(r.cmpTo.getTime()).toBe(r.from.getTime());
        expect(r.cmpTo.getTime() - r.cmpFrom.getTime()).toBe(r.to.getTime() - r.from.getTime());
    });

    it('12m yields 12 monthly buckets', () => {
        const r = resolveBiRange({ ...base, period: '12m' }, new Date('2026-11-20T15:00:00Z'), TZ);
        const b = buckets(r);
        expect(b).toHaveLength(12);
        expect(b[0]).toBe('2025-12');
        expect(b[11]).toBe('2026-11');
    });

    it('year comparison over 29 February falls back to 28 February', () => {
        const r = resolveBiRange(
            { ...base, period: 'custom', from: '2028-02-29', to: '2028-03-02', compare: 'year' },
            new Date('2028-03-10T12:00:00Z'), TZ,
        );
        expect(r.cmpFrom.toISOString()).toBe('2027-02-28T06:00:00.000Z');
    });

    it('custom of 90 days uses monthly granularity', () => {
        const r = resolveBiRange(
            { ...base, period: 'custom', from: '2026-08-01', to: '2026-10-29' },
            new Date('2026-11-20T12:00:00Z'), TZ,
        );
        expect(r.days).toBe(90);
        expect(r.granularity).toBe('month');
        expect(buckets(r)).toEqual(['2026-08', '2026-09', '2026-10']);
    });

    it('rejects invalid custom ranges', () => {
        expect(() => resolveBiRange({ ...base, period: 'custom', from: '2026-10-05', to: '2026-10-01' }, new Date(), TZ)).toThrow();
        expect(() => resolveBiRange({ ...base, period: 'custom' }, new Date(), TZ)).toThrow();
    });
});

describe('bucketKey', () => {
    it('places a 00:30 local sale on the local day', () => {
        const d = new Date('2026-11-20T06:30:00Z'); // 00:30 Managua on the 20th
        expect(bucketKey(d, 'day', TZ)).toBe('2026-11-20');
        expect(bucketKey(d, 'hour', TZ)).toBe('2026-11-20T00');
        expect(bucketKey(d, 'month', TZ)).toBe('2026-11');
    });
});
