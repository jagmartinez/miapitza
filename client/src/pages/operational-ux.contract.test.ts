import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('operational UX contracts', () => {
    it('keeps the main shell fluid and centers every routed view at 1700px', () => {
        const shellSource = read('../ui/layout/AppShell.tsx');
        const layoutStyles = read('../ui/layout/layout.css');
        const dashboardStyles = read('./Dashboard.css');

        expect(layoutStyles).toContain('.ui-shell__main {');
        expect(layoutStyles).toContain('min-width: 0');
        expect(shellSource).toContain('<div className="ui-shell__inner">');
        expect(layoutStyles).toContain('.ui-shell__inner {');
        expect(layoutStyles).toContain('max-width: 1700px');
        expect(dashboardStyles).toContain('max-width: 1700px');
        expect(dashboardStyles).toContain('margin: 0 auto');
    });

    it('renders Mesas inside the normal shell (rail + topbar) as in the approved mockup', () => {
        const tablesSource = read('./Tables.tsx');
        const tablesStyles = read('./Tables.css');
        const layoutSource = read('../components/Layout.tsx');

        expect(layoutSource).toContain("const isTableWorkspace = location.pathname === '/kds'");
        expect(tablesSource).toContain("view === 'plan' ? 'tables-page--map' : 'tables-page--ops'");
        expect(tablesStyles).toContain('.tables-page--map .table-map-shell');
        expect(tablesStyles).not.toContain('width: 100dvw !important');
        expect(tablesStyles).toContain('.tables-page:not(.tables-page--map)');
    });

    it('keeps catalog actions aligned and secondary routes out of the primary menu', () => {
        const toggleSource = read('../components/ViewToggle.tsx');
        const toggleStyles = read('../components/ViewToggle.css');
        const layoutSource = read('../components/Layout.tsx');

        expect(toggleSource).toContain('view-toggle catalog-view-toggle');
        expect(toggleStyles).toContain('.view-toggle.catalog-view-toggle');
        expect(toggleStyles).toContain('height: 44px');
        expect(layoutSource).not.toContain("{ to: '/kardex'");
    });

    it('exposes Catering table and logistics modes', () => {
        const cateringSource = read('./Catering.tsx');

        expect(cateringSource).toContain("type CateringViewMode = 'grid' | 'table' | 'calendar'");
        expect(cateringSource).toContain("activeTab === 'logistics'");
        expect(cateringSource).toContain('<DataTable<CateringEvent>');
    });

    it('keeps modal content flush without nested section cards or reserved scrollbar space', () => {
        const sharedStyles = read('../index.css');
        const modalSection = sharedStyles.slice(
            sharedStyles.indexOf('.modal-section,'),
            sharedStyles.indexOf('.modal-section-header {'),
        );

        expect(sharedStyles).not.toContain('scrollbar-gutter: stable');
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
        expect(source).toContain('<FullScreenModal');
        expect(source).toContain('aria-label="Verificar inventario"');
        // El pie fijo de FullScreenModal envía el formulario del evento (sin premium-modal-content).
        expect(source).not.toContain('premium-modal-content');
        expect(source).toContain('form="catering-event-form" loading={savingEvent}');
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

        expect(source).toContain('kind="multi"');
        expect(source).toContain('categoryIds');
        expect(source).toContain("filters.categoryIds.split(',')");
        expect(source).toContain("set('categoryIds', ids.join(','))");
        expect(source).toContain('hasMultiCategoryFilter(reportId)');
        expect(source).toContain('<PageContent>');
    });

    it('the kitchen ignores waiter ITEMS_CHANGED / GUESTS_CHANGED order updates (M7)', () => {
        const kitchen = read('./Kitchen.tsx');
        const guard = kitchen.indexOf("message.payload?.status === 'ITEMS_CHANGED'");
        expect(guard).toBeGreaterThan(-1);
        expect(kitchen).toContain("message.payload?.status === 'GUESTS_CHANGED'");
        // The guard returns before the refetch branch that handles ORDER_UPDATE.
        expect(guard).toBeLessThan(kitchen.indexOf('message.type === WS_EVENTS.ORDER_SENT_TO_KITCHEN'));
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

    it('keeps an invoiced table account attached until the backend confirms full payment', () => {
        const pos = read('./POS.tsx');
        const paymentFlow = pos.slice(
            pos.indexOf('const handlePayment = async () => {'),
            pos.indexOf('handlePaymentRef.current = handlePayment;'),
        );
        const postInvoiceFlow = paymentFlow.slice(paymentFlow.indexOf('let payableOrder = paymentSnapshot'));
        const paymentCompleteFlow = pos.slice(
            pos.indexOf('const handlePaymentComplete = async'),
            pos.indexOf('const handleCancelActiveOrder = useCallback'),
        );

        expect(pos).toContain('findTableAccountForTable(response.data.data as Order[], table.id)');
        expect(pos).toContain('if (!isEligibleForPosOrderBucket(refreshedOrder))');
        expect(postInvoiceFlow).toContain('setPaymentOrder(payableOrder)');
        expect(postInvoiceFlow).toContain('setActiveTableOrder(payableOrder)');
        expect(postInvoiceFlow).toContain('clearDraftCart');
        expect(postInvoiceFlow).not.toContain('releaseAfterConfirmedInvoice(');
        expect(postInvoiceFlow).not.toContain('clearTableContext');
        expect(postInvoiceFlow).not.toContain('syncOrderContext(orderId)');
        expect(paymentCompleteFlow).toContain('clearTableContext');
        expect(pos).toContain('orderId={paymentOrder?.id ?? null}');
        expect(pos).toContain('order={paymentOrder}');
        expect(paymentFlow.indexOf('ordersAPI.updateFiscalCustomer(orderId')).toBeLessThan(
            paymentFlow.indexOf('invoicesAPI.issuePreInvoice(orderId)'),
        );
    });

    it('never presents a post-confirmation refresh failure as a failed payment', () => {
        const pos = read('./POS.tsx');
        const paymentCompleteFlow = pos.slice(
            pos.indexOf('const handlePaymentComplete = async'),
            pos.indexOf('const handleCancelActiveOrder = useCallback'),
        );

        expect(paymentCompleteFlow).toContain('const refreshed = await loadData(false)');
        expect(paymentCompleteFlow).toContain('El pago fue confirmado, pero el POS no pudo actualizarse.');
        expect(paymentCompleteFlow).toContain('El pago fue confirmado, pero el mapa operativo no pudo actualizarse.');
        expect(paymentCompleteFlow).not.toContain("showError('Error al procesar el pago.')");
    });

    it('communicates the delivery handoff and exposes it only with orders.deliver', () => {
        const orders = read('./Orders.tsx');
        const pos = read('./POS.tsx');
        const tables = read('./Tables.tsx');
        const kitchen = read('./Kitchen.tsx');

        expect(pos).toContain('Pago confirmado y factura ${paymentData.fiscalInvoice.invoiceNumber} emitida.');
        expect(pos).not.toContain('settleReadyTableOnPayment');
        expect(orders).toContain("const canDeliver = canDeliverOrder(user)");
        expect(orders).toContain("if (canDeliver && order.status === 'READY'");
        expect(orders).toContain('Pago confirmado y factura ${result.fiscalInvoice.invoiceNumber} emitida.');
        expect(orders).toContain('await loadOrders();');
        expect(orders).toContain('La orden seguirá visible como pendiente hasta confirmar la entrega.');
        expect(orders).toContain('al entregar se descontará allí el inventario.');
        expect(orders).toContain('El inventario fue descontado de la bodega seleccionada.');
        expect(orders).not.toContain('settleReadyTableOnPayment');
        expect(orders).toContain('setOrders(rows)');
        expect(kitchen).toContain('ordersAPI.getKitchenQueue()');
        expect(tables).toContain('Pago confirmado y factura ${result.fiscalInvoice.invoiceNumber} emitida.');
        expect(tables).toContain('await refreshOperationalTable();');
        expect(tables).toContain('Las cuentas fueron consolidadas en la mesa principal');
        expect(tables).toContain('Emite la factura para continuar al cobro.');
        expect(tables).not.toContain('Cuentas consolidadas. ${buildInvoiceStatusMessage({');
        expect(tables).not.toContain('settleReadyTableOnPayment');
        expect(tables).toContain('doesOrderRemainVisibleAtTable(order)');
    });
});
