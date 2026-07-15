import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('operational UX contracts', () => {
    it('keeps the main shell fluid and centers every routed view at 1700px', () => {
        const layoutSource = read('../components/Layout.tsx');
        const layoutStyles = read('../components/Layout.css');
        const dashboardStyles = read('./Dashboard.css');

        expect(layoutStyles).toContain('.main-content {');
        expect(layoutStyles).toContain('max-width: none');
        expect(layoutSource).toContain('<div className="main-content-inner">');
        expect(layoutStyles).toContain('.main-content-inner {');
        expect(layoutStyles).toContain('max-width: 1700px');
        expect(layoutStyles).toContain('.main-content-inner > * {');
        expect(layoutStyles).toContain('max-width: 1700px !important');
        expect(layoutStyles).toContain('.main-content.workspace-content > .main-content-inner');
        expect(layoutStyles).toContain('height: 100%');
        expect(dashboardStyles).toContain('max-width: 1700px');
        expect(dashboardStyles).toContain('margin: 0 auto');
    });

    it('keeps modal content flush without nested section cards or reserved scrollbar space', () => {
        const sharedStyles = read('../index.css');
        const modalStyles = read('../components/Modal.css');
        const sidebarStyles = read('../components/Sidebar.css');
        const modalSection = sharedStyles.slice(
            sharedStyles.indexOf('.modal-section,'),
            sharedStyles.indexOf('.modal-section-header {'),
        );

        expect(sharedStyles).not.toContain('scrollbar-gutter: stable');
        expect(modalStyles).not.toContain('scrollbar-gutter: stable');
        expect(sidebarStyles).not.toContain('scrollbar-gutter: stable');
        expect(modalSection).toContain('width: 100%');
        expect(modalSection).not.toContain('padding:');
        expect(modalSection).not.toContain('border:');
        expect(modalSection).not.toContain('box-shadow:');
    });

    it('keeps the catering event editor flat and aligned with the shared modal workspace', () => {
        const source = read('./Catering.tsx');
        const styles = read('./CateringMod.css');

        expect(source).not.toContain('catering-event-intro');
        expect(source).not.toContain('animate-slide-in');
        expect(source).toContain('modal-content-group catering-event-section');
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

    it('uses the dedicated kitchen and explicit-warehouse delivery boundaries', () => {
        const orders = read('./Orders.tsx');
        const pos = read('./POS.tsx');

        expect(orders).toContain('ordersAPI.markKitchenReady(orderId)');
        expect(orders).toContain('canManageKitchen &&');
        expect(pos).toContain('ordersAPI.complete(activeTableOrder.id, operationalWarehouseId)');
        expect(pos).toContain('ordersAPI.cancel(activeTableOrder.id, pendingCancelReason, operationalWarehouseId)');
        expect(pos).not.toContain("ordersAPI.updateStatus(activeTableOrder.id, 'DELIVERED')");
        expect(pos.match(/ordersAPI\.updatePricing\(orderId/g)).toHaveLength(2);
        expect(pos).toContain('La orden no se enviará a cocina hasta sincronizar el precio.');
    });
});
