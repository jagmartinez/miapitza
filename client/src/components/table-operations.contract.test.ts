import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tablesSource = read('../pages/Tables.tsx');
const panelSource = read('./TableOrdersModal.tsx');
const posSource = read('../pages/POS.tsx');
const paymentSource = read('./PaymentModal.tsx');
const ordersSource = read('../pages/Orders.tsx');
const mapSource = read('./TableMap.tsx');
const chairLayoutSource = read('./tableChairLayout.ts');
const operationSource = read('./TableOperationModal.tsx');
const selectionSource = read('./TableSelectionModal.tsx');
const groupSource = read('./TableGroupModal.tsx');
const groupStyles = read('./TableGroupModal.css');
const cartStyles = read('./OrderCart.css');
const posStyles = read('../pages/POS.css');
const kitchenSource = read('../pages/Kitchen.tsx');
const layoutSource = read('./Layout.tsx');
const bellSource = read('./KitchenNotificationBell.tsx');
const panelStyles = read('./TableOrdersModal.module.css');
const apiSource = read('../services/api.ts');
const tableAccountServiceSource = read('../../../server/src/services/table-account.service.ts');

describe('table operational center contract', () => {
    it('opens the real POS workspace with the selected table', () => {
        expect(tablesSource).toContain('initialTableId={posTable.id}');
        expect(tablesSource).toContain('embedded');
        expect(posSource).toContain('initialTableId?: number');
        expect(posSource).toContain('tables.find((candidate) => candidate.id === initialTableId)');
    });

    it('exposes order, invoice, payment and split actions from the table panel', () => {
        expect(panelSource).toContain("'Agregar productos'");
        expect(panelSource).not.toContain('Abrir pedido');
        expect(panelSource).not.toContain('Continuar pedido');
        expect(panelSource).toContain('canOperatePOS');
        expect(panelSource).toContain('Emitir Factura');
        expect(panelSource).not.toContain('Imprimir cuenta');
        expect(panelSource.match(/Agregar productos/g)).toHaveLength(1);
        expect(panelSource.match(/Emitir Factura/g)).toHaveLength(1);
        expect(panelSource).toContain('invoiceTargetOrderId');
        expect(panelSource).toContain('Cobrar');
        expect(panelSource).toContain('Dividir por consumo');
        expect(paymentSource).toContain("initialMode?: 'single' | 'split'");
    });

    it('keeps prefactura issuance before collection and fiscal issuance after payment', () => {
        const ordersPaymentFlow = ordersSource.slice(
            ordersSource.indexOf('const handlePaymentClick = async'),
            ordersSource.indexOf('const handlePaymentComplete ='),
        );
        expect(tablesSource.indexOf("window.open('', '_blank')")).toBeLessThan(
            tablesSource.indexOf('await invoicesAPI.issuePreInvoice(order.id)')
        );
        expect(tablesSource).toContain('invoiceWindow.close()');
        expect(tablesSource).toContain('renderPreInvoiceHtml(invoice)');
        expect(tablesSource.indexOf('invoicesAPI.issuePreInvoice(order.id)')).toBeLessThan(
            tablesSource.indexOf("setPaymentMode(mode)")
        );
        expect(ordersSource.indexOf('await invoicesAPI.issuePreInvoice(order.id)')).toBeLessThan(
            ordersSource.indexOf('setShowPaymentModal(true)')
        );
        expect(posSource.indexOf('invoicesAPI.issuePreInvoice(orderId)')).toBeLessThan(
            posSource.indexOf('setShowPaymentModal(true)')
        );
        expect(tablesSource).not.toContain('await invoicesAPI.issue(order.id)');
        expect(ordersPaymentFlow).not.toContain('await invoicesAPI.issue(order.id)');
        expect(posSource).not.toContain('await invoicesAPI.issue(orderId)');
        expect(paymentSource).toContain('renderInvoiceHtml(completion.fiscalInvoice)');
    });

    it('offers an audited prefactura reversal before payments so the same account can receive late products', () => {
        expect(panelSource).toContain('Revertir prefactura');
        expect(panelSource).toContain('preInvoiceReverseReason');
        expect(panelSource).toContain('onReversePreInvoice(order, reason)');
        expect(tablesSource).toContain('invoicesAPI.reversePreInvoice(order.id, reason)');
        expect(tablesSource).toContain('Ya puedes agregar productos a la misma cuenta');
        expect(apiSource).toContain('/preinvoice/reverse');
    });

    it('renders editable persisted floor areas and table geometry', () => {
        expect(mapSource).toContain('plan.areas.map(normalizeArea)');
        expect(mapSource).toContain('Agregar salón');
        expect(mapSource).toContain("value: 'ROUND'");
        expect(mapSource).toContain('Guardar plano');
        expect(tablesSource).toContain('tablesAPI.updateFloorPlan');
    });

    it('uses table capacity as the exact one-to-one chair and diner count', () => {
        expect(mapSource).toContain('data-chair-count={chairs.length}');
        expect(mapSource).toContain("'silla' : 'sillas'");
        expect(mapSource).toContain("'comensal' : 'comensales'");
        expect(chairLayoutSource).not.toContain('Math.min(10');
        expect(tablesSource).toContain('Sillas / comensales (relación 1:1)');
        expect(tablesSource).toContain('Cada silla representa un comensal');
    });

    it('keeps the map toolbar focused on filters and floor-plan actions', () => {
        expect(mapSource).toContain('Todas las mesas');
        expect(mapSource).not.toContain('Cambiar mesa');
        expect(mapSource).not.toContain('Consolidar');
        expect(panelSource).toContain('Cambiar mesa');
        expect(panelSource).toContain('Consolidar');
        expect(mapSource).toContain('Nueva mesa');
        expect(mapSource).toContain('onStatusFilterChange');
        expect(tablesSource).toMatch(/!showMap && \(\s*<PageContent>\s*<PageHeader/);
        expect(tablesSource).toContain('branchControl=');
        expect(mapSource).not.toContain('<select');
        expect(mapSource).not.toContain('onShowList');
        expect(mapSource).not.toContain('<span>Estado</span>');
        expect(mapSource).toContain('canvas-resize-handle');
        expect(mapSource.indexOf('Nueva mesa')).toBeLessThan(mapSource.indexOf('Administración'));
        expect(tablesSource).toContain('themeControl={(');
        expect(tablesSource).toContain('<KitchenNotificationBell inline />');
    });

    it('allows selecting a floor area by pointer, keyboard or the editor selector', () => {
        expect(mapSource).toContain('Editar salón');
        expect(mapSource).toContain('event.stopPropagation()');
        expect(mapSource).toContain("setSelection({ kind: 'area', key })");
        expect(mapSource).toContain("event.key !== 'Enter'");
    });

    it('does not render the removed split financial summary', () => {
        expect(paymentSource).not.toContain('split-financial-summary');
        expect(paymentSource).toContain('Por unidades');
        expect(paymentSource).toContain('¿Quién paga cada plato?');
        expect(paymentSource).toContain('unit-payer-options');
        expect(paymentSource).toContain('assignItemUnit');
    });

    it('uses themed react-select controls throughout table operations', () => {
        expect(operationSource).toContain('AppSelect');
        expect(operationSource).toContain('Cuenta principal / mesa destino');
        expect(operationSource).toContain('initialTableId');
        expect(tablesSource).toContain('initialTableId={operationTableId}');
        expect(operationSource).not.toContain('<select');
        expect(mapSource).toContain('AppSelect<');
        expect(operationSource).toContain('Buscar por mesa o salón');
        expect(operationSource).toContain('visibleConsolidationSources');
        expect(operationSource).toContain('.filter((table) => String(table.id) !== sourceTableId)');
        expect(operationSource).toContain('No hay otra mesa compatible disponible como destino.');
        expect(tableAccountServiceSource).toContain("if (sourceTableId === destinationTableId)");
        expect(tableAccountServiceSource).toContain('Seleccione una mesa destino diferente');
        expect(selectionSource).toContain('table.id !== excludeTableId');
        expect(posSource).toContain('excludeTableId={selectedTable?.id}');
    });

    it('separates physical grouping from financial consolidation and shows both flows', () => {
        expect(groupSource).toContain('Unión física, no financiera');
        expect(groupSource).toContain('sillas =');
        expect(groupStyles).toContain('.table-group-route');
        expect(mapSource).toContain('table-group-connections');
        expect(mapSource).toContain('Principal de');
        expect(panelSource).toContain('Unir mesas');
        expect(panelSource).toContain('Separar todas');
        expect(panelSource).not.toContain('Consolidar y cobrar');
        expect(panelSource).toContain("['AVAILABLE', 'OCCUPIED'].includes(table.status)");
        expect(groupSource).toContain('const limit = editing ? 20 : 19');
        expect(operationSource).toContain('table-transfer-route');
        expect(operationSource).toContain('Se libera al completar');
        expect(operationSource).toContain('(table.activeTableGroupId ?? null) === (selectedTransferSource.activeTableGroupId ?? null)');
        expect(panelSource).toContain('const canStartFinancialConsolidation = canConsolidate');
        expect(panelSource).toContain('&& !loadingConsolidation');
        expect(panelSource).toContain('&& !consolidationLookupError');
        expect(panelSource).toContain('&& !hasActiveFinancialConsolidation');
        expect(tablesSource).not.toContain('consolidationIntent');
        expect(tablesSource).toContain('Emite la factura para continuar al cobro');
        expect(panelSource).toContain('Emitir Factura');
        expect(panelSource).toContain('Cobrar');
    });

    it('keeps the POS cart footer visible while only the item list scrolls', () => {
        expect(posStyles).toContain('.cart-area > .order-cart');
        expect(posStyles).toContain('flex: 1 1 auto');
        expect(posStyles).toContain('min-height: 0');
        expect(cartStyles).toContain('.cart-items-list');
        expect(cartStyles).toContain('overflow-y: auto');
        expect(cartStyles).toContain('.cart-footer');
        expect(cartStyles).toContain('flex-shrink: 0');
        expect(posSource).toContain('className="pos-active-order-summary"');
    });

    it('rediscovers and reverses only an ACTIVE financial consolidation', () => {
        expect(apiSource).toContain("api.get('/tables/consolidations/active'");
        expect(apiSource).toContain("api.post(`/tables/consolidations/${id}/reverse`");
        expect(apiSource).toContain("headers: { 'X-Idempotency-Key': data.reversalKey }");
        expect(tablesSource).toContain("discovered?.status === 'ACTIVE' ? discovered : null");
        expect(tablesSource).toContain('getIdempotentAttempt(reversalAttemptRef.current, fingerprint)');
        expect(tablesSource).toContain('expectedVersion: activeConsolidation.version');
        expect(tablesSource).toContain('loadActiveConsolidation(selectedTable.id)');
        expect(panelSource).toContain('Motivo obligatorio');
        expect(panelSource).toContain('Confirmar reverso de consolidación');
        expect(panelSource).toContain('pagos, factura, entrega, cambios en productos u otra ocupación');
        expect(panelSource).toContain("activeConsolidation?.status === 'ACTIVE'");
        expect(panelSource).toContain('El estado ACTIVE no garantiza que el reverso siga siendo posible');
        expect(panelSource).toContain('El reverso no se completó');
        expect(tablesSource).toContain('setConsolidationReversalError(message)');
    });

    it('keeps a single orders view without the removed Cuenta tab', () => {
        expect(panelSource).toContain('Órdenes activas');
        expect(panelSource).not.toContain('orders-section-heading');
        expect(panelSource).not.toContain("useState<'orders' | 'bill'>");
        expect(panelSource).not.toContain('role="tablist"');
    });

    it('uses the full-screen modal with touch-sized actions and no horizontal overflow', () => {
        expect(panelSource).toContain('<FullScreenModal');
        expect(panelSource).toContain('<DataTable');
        expect(panelSource).toContain('formatMoney(');
        expect(panelStyles).toContain('min-height: var(--ui-control-touch)');
        expect(panelStyles).toContain('flex-wrap: wrap');
        expect(panelStyles).toContain('.addProducts');
        expect(panelStyles).toContain('display: none');
        expect(panelSource).toContain("loading ? 'Cargando…'");
    });

    it('uses effective table permissions and locks operational users to their active branch', () => {
        expect(tablesSource).toContain('getTableAccess(user)');
        expect(tablesSource).toContain('Sucursal activa');
        expect(tablesSource).toContain('setBranchFilter(user?.branchId ?? null)');
        expect(tablesSource).toContain('table-map-fixed-branch');
    });

    it('makes physical group size explicit and draws a radial connector for larger groups', () => {
        expect(mapSource).toContain('members.length === 2');
        expect(mapSource).toContain('table-group-hub');
        expect(mapSource).toContain('members.map((table)');
        expect(mapSource).toContain('Grupo de ${groupMembers.length} mesas');
        expect(mapSource).toContain('Mesa ${groupPosition}/${groupMembers.length}');
        expect(mapSource).toContain("'PENDING_PAYMENT', label: 'Mesa pendiente de pago'");
        expect(mapSource).not.toContain('Etiqueta: cantidad exacta del grupo');
        expect(groupSource).toContain('Selección exacta: ${groupTableLabel}');
    });

    it('edits one group member without closing the whole physical group', () => {
        expect(panelSource).toContain('Editar grupo');
        expect(groupSource).toContain("mode: 'EDIT'");
        expect(groupSource).toContain('expectedMemberTableIds');
        expect(groupSource).toContain('expectedPrimaryTableId');
        expect(groupSource).toContain('setPrimaryTableId(next[0] ?? null)');
        expect(groupSource).toContain('Mesas que permanecerán unidas');
        expect(tablesSource).toContain('tablesAPI.updateGroup');
        expect(apiSource).toContain("api.patch(`/tables/groups/${groupId}`");
    });

    it('limits kitchen fullscreen and administration navigation to the KDS rules', () => {
        expect(kitchenSource).toContain("if (!displayMode) return");
        expect(kitchenSource).toContain('displayMode && canReturnToAdministration');
        expect(kitchenSource).not.toContain('kitchen-items-summary');
        expect(kitchenSource).toContain("displayMode ? 'is-display-mode' : 'is-pc-mode'");
        expect(kitchenSource).toContain('Productos de la orden');
    });

    it('mounts the kitchen alert bell only inside Tables and announces new alerts', () => {
        expect(tablesSource).toContain('<KitchenNotificationBell inline />');
        expect(layoutSource).not.toContain('<KitchenNotificationBell');
        expect(bellSource).toContain('playNotificationSound()');
        expect(bellSource).toContain('navigator.vibrate');
    });
});
