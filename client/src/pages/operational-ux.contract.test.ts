import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('operational UX contracts', () => {
    it('keeps the main shell fluid and centers the dashboard at 1700px', () => {
        const layoutStyles = read('../components/Layout.css');
        const dashboardStyles = read('./Dashboard.css');

        expect(layoutStyles).toContain('.main-content {');
        expect(layoutStyles).toContain('max-width: none');
        expect(dashboardStyles).toContain('max-width: 1700px');
        expect(dashboardStyles).toContain('margin: 0 auto');
    });

    it('keeps the catering event editor structured as one guided workspace', () => {
        const source = read('./Catering.tsx');
        const styles = read('./CateringMod.css');

        expect(source).toContain('catering-event-intro');
        expect(source).toContain('catering-info-layout');
        expect(source).toContain('width="wide"');
        expect(styles).toContain('--catering-control-height: 46px');
        expect(styles).toContain('.catering-event-section');
        expect(styles).toContain('minmax(220px, .8fr) minmax(300px, 1.2fr) auto');
        expect(styles).toContain('.catering-customer-section .modal-form-row');
    });

    it('supports selecting several categories in sales reports end to end', () => {
        const source = read('./Reports.tsx');
        const styles = read('./Reports.css');

        expect(source).toContain('<Select<FilterOption, true>');
        expect(source).toContain('categoryIds');
        expect(source).toContain('closeMenuOnSelect={false}');
        expect(source).toContain('CompactCategoryMultiValue');
        expect(styles).toContain('.report-category-summary');
        expect(styles).toContain('max-width: 1700px');
        expect(styles).toContain('.reports-page > .reports-detail-page');
    });
});
