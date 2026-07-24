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

    it('lets only the operational table map use the complete viewport', () => {
        const tablesSource = read('./Tables.tsx');
        const tablesStyles = read('./Tables.css');

        expect(tablesSource).toContain("showMap ? 'tables-page--map' : 'tables-page--list'");
        expect(tablesStyles).toContain('.tables-page--map {');
        expect(tablesStyles).toContain('width: 100dvw !important');
        expect(tablesStyles).toContain('margin-inline: calc(50% - 50dvw) !important');
        expect(tablesStyles).toContain('padding: 0');
        expect(tablesStyles).toContain('.tables-page--map .table-map-shell');
        expect(tablesStyles).toContain('border-inline: 0');
        expect(tablesStyles).toContain('border-radius: 0');
        expect(tablesStyles).toContain('.tables-page:not(.tables-page--map)');
    });

    it('keeps catalog actions aligned and secondary routes out of the primary menu', () => {
        const toggleSource = read('../components/ViewToggle.tsx');
        const toggleStyles = read('../components/CatalogView.css');
        const layoutSource = read('../components/Layout.tsx');

        expect(toggleSource).toContain('view-toggle catalog-view-toggle');
        expect(toggleStyles).toContain('.view-toggle.catalog-view-toggle');
        expect(toggleStyles).toContain('height: 44px');
        expect(layoutSource).not.toContain("{ to: '/kardex'");
    });

    it('centers KDS empty results and exposes Catering table and logistics modes', () => {
        const kitchenStyles = read('./Kitchen.css');
        const cateringSource = read('./Catering.tsx');

        expect(kitchenStyles).toContain('.kitchen-grid-new > .empty-state');
        expect(kitchenStyles).toContain('grid-column: 1 / -1');
        expect(cateringSource).toContain("type CateringViewMode = 'grid' | 'table' | 'calendar'");
        expect(cateringSource).toContain("activeTab === 'logistics'");
        expect(cateringSource).toContain('<CatalogTable<CateringEvent>');
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
        expect(source).not.toContain('width="wide"');
        expect(source).toContain('width="medium"');
        expect(source).toContain('aria-label="Verificar inventario"');
        expect(source).toContain('className="modal-form-new"');
        expect(source).toContain('<Button type="submit" disabled={savingEvent}>');
        expect(styles).not.toContain('--catering-control-height: 46px');
        expect(styles).toContain('.catering-event-section');
        expect(styles).toContain('minmax(180px, .7fr) minmax(260px, 1.3fr)');
        expect(styles).not.toContain('.catering-section-heading');
    });

    it('keeps menu view and edit as separate actions with recipe-style detail', () => {
        const source = read('./Menu.tsx');

        expect(source).toContain('title="Detalle del Plato"');
        expect(source).toContain('data-testid="menu-item-detail"');
        expect(source).toContain('inventory-detail-hero');
        expect(source).toContain('handleOpenDetail(item)');
        expect(source).not.toContain('title="Ver / Editar"');
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
        expect(orders).toContain('ordersAPI.complete(orderId, warehouseId)');
        expect(pos).not.toContain('ordersAPI.complete(');
        expect(pos).toContain('ordersAPI.cancel(orderId, cancelReason, warehouseId)');
        expect(pos).not.toContain("ordersAPI.updateStatus(activeTableOrder.id, 'DELIVERED')");
        expect(pos.match(/ordersAPI\.updatePricing\(orderId/g)).toHaveLength(2);
        expect(pos).toContain('La orden no se enviará a cocina hasta sincronizar el precio.');
    });

    it('wires delivery attempts through the executable gate and preserves explicit feedback', () => {
        const orders = read('./Orders.tsx');
        const pos = read('./POS.tsx');

        expect(orders).toContain('deliveryAttemptGateRef.current.execute');
        expect(orders).toContain("showError(message)");
        expect(orders).toContain("completingDelivery ? 'Entregando…' : 'Confirmar Entrega'");
        expect(orders).toContain('La orden fue entregada, pero no se pudo actualizar la lista.');
        expect(pos).not.toContain('handleMarkDelivered');
        expect(pos).not.toContain("setWarehouseAction('DELIVER')");
        expect(pos).not.toContain('>Entregar</button>');
        expect(pos).not.toContain('syncOrderContext(activeTableOrder.id)');
    });

    it('releases the POS bucket at confirmed invoicing and never re-adopts fiscal orders', () => {
        const pos = read('./POS.tsx');
        const paymentFlow = pos.slice(
            pos.indexOf('const handlePayment = async () => {'),
            pos.indexOf('handlePaymentRef.current = handlePayment;'),
        );
        const postInvoiceFlow = paymentFlow.slice(paymentFlow.indexOf('const invoiceResponse'));
        const paymentCompleteFlow = pos.slice(
            pos.indexOf('const handlePaymentComplete = async'),
            pos.indexOf('const handleCancelActiveOrder = useCallback'),
        );

        expect(pos).toContain('findPosOrderBucketForTable(response.data.data as Order[], table.id)');
        expect(pos).toContain('if (!isEligibleForPosOrderBucket(refreshedOrder))');
        expect(postInvoiceFlow).toContain('setPaymentOrder(invoicedPaymentOrder)');
        expect(postInvoiceFlow).toContain('releaseAfterConfirmedInvoice(');
        expect(postInvoiceFlow).toContain('clearTableContext');
        expect(postInvoiceFlow).not.toContain('syncOrderContext(orderId)');
        expect(paymentCompleteFlow).not.toContain('clearTableContext');
        expect(pos).toContain('orderId={paymentOrder?.id ?? null}');
        expect(pos).toContain('order={paymentOrder}');
        expect(paymentFlow.indexOf('if (offlineQueued)')).toBeLessThan(
            paymentFlow.indexOf('const invoiceResponse'),
        );
    });

    it('communicates the delivery handoff and exposes it only with orders.deliver', () => {
        const orders = read('./Orders.tsx');
        const pos = read('./POS.tsx');
        const tables = read('./Tables.tsx');
        const kitchen = read('./Kitchen.tsx');

        expect(pos).toContain('buildInvoiceReleaseMessage({');
        expect(pos).not.toContain('settleReadyTableOnPayment');
        expect(orders).toContain("const canDeliver = canDeliverOrder(user)");
        expect(orders).toContain("if (canDeliver && order.status === 'READY'");
        expect(orders).toContain('success(buildInvoiceReleaseMessage({');
        expect(orders).toContain('await loadOrders();');
        expect(orders).toContain('La orden seguirá visible como pendiente hasta confirmar la entrega.');
        expect(orders).toContain('al entregar se descontará allí el inventario.');
        expect(orders).toContain('El inventario fue descontado de la bodega seleccionada.');
        expect(orders).not.toContain('settleReadyTableOnPayment');
        expect(orders).toContain('setOrders(response.data.data)');
        expect(kitchen).toContain('ordersAPI.getKitchenQueue()');
        expect(tables).toContain('showSuccess(buildInvoiceReleaseMessage({');
        expect(tables).toContain('await refreshOperationalTable();');
        expect(tables).toContain('Cuentas consolidadas. ${buildInvoiceReleaseMessage({');
        expect(tables).not.toContain('settleReadyTableOnPayment');
        expect(tables).toContain('isEligibleForPosOrderBucket(o)');
    });
});
