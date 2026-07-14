import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('operational UX contracts', () => {
    it('keeps the catering event editor structured as one guided workspace', () => {
        const source = read('./Catering.tsx');
        const styles = read('./CateringMod.css');

        expect(source).toContain('catering-event-intro');
        expect(source).toContain('catering-info-layout');
        expect(source).toContain('width="wide"');
        expect(styles).toContain('--catering-control-height: 46px');
        expect(styles).toContain('.catering-event-section');
    });

    it('supports selecting several categories in sales reports end to end', () => {
        const source = read('./Reports.tsx');
        const styles = read('./Reports.css');

        expect(source).toContain('<Select<FilterOption, true>');
        expect(source).toContain('categoryIds');
        expect(source).toContain('closeMenuOnSelect={false}');
        expect(styles).toContain('max-width: 1700px');
        expect(styles).toContain('.reports-page > .reports-detail-page');
    });
});
