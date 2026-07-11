import { loadEntries } from '../../scripts/normalize-reference-only-averages';

describe('reference-only average normalization contract', () => {
    it('loads the 22 unique positive reference costs managed by recipe catalog maps', async () => {
        const entries = await loadEntries();
        expect(entries).toHaveLength(22);
        expect(new Set(entries.map((entry) => entry.productSku)).size).toBe(entries.length);
        expect(entries.every((entry) => entry.referenceCost > 0)).toBe(true);
    });
});
