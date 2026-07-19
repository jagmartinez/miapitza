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
const kitchenSource = read('../pages/Kitchen.tsx');
const layoutSource = read('./Layout.tsx');
const bellSource = read('./KitchenNotificationBell.tsx');
const panelStyles = read('./TableOrdersModal.css');

describe('table operational center contract', () => {
    it('opens the real POS workspace with the selected table', () => {
        expect(tablesSource).toContain('initialTableId={posTable.id}');
        expect(tablesSource).toContain('embedded');
        expect(posSource).toContain('initialTableId?: number');
        expect(posSource).toContain('tables.find((candidate) => candidate.id === initialTableId)');
    });

    it('exposes order, invoice, payment and split actions from the table panel', () => {
        expect(panelSource).toContain('Abrir pedido');
        expect(panelSource).toContain('canOperatePOS');
        expect(panelSource).toContain('Emitir factura');
        expect(panelSource).toContain('Cobrar');
        expect(panelSource).toContain('Dividir por consumo');
        expect(paymentSource).toContain("initialMode?: 'single' | 'split'");
    });

    it('keeps invoice issuance before collection in every order entry point', () => {
        expect(tablesSource.indexOf('invoicesAPI.issue(order.id)')).toBeLessThan(
            tablesSource.indexOf("setPaymentMode(mode)")
        );
        expect(ordersSource.indexOf('await invoicesAPI.issue(order.id)')).toBeLessThan(
            ordersSource.indexOf('setShowPaymentModal(true)')
        );
        expect(posSource.indexOf('invoicesAPI.issue(orderId)')).toBeLessThan(
            posSource.indexOf('setShowPaymentModal(true)')
        );
    });

    it('renders editable persisted floor areas and table geometry', () => {
        expect(mapSource).toContain('plan.areas.map(normalizeArea)');
        expect(mapSource).toContain('Agregar salón');
        expect(mapSource).toContain("mapShape: 'ROUND'");
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
        expect(tablesSource).toContain('!showMap && <PageHeader');
        expect(tablesSource).toContain('branchControl=');
        expect(mapSource).not.toContain('<select');
        expect(mapSource).not.toContain('onShowList');
        expect(mapSource).not.toContain('<span>Estado</span>');
        expect(mapSource).toContain('canvas-resize-handle');
        expect(mapSource.indexOf('Nueva mesa')).toBeLessThan(mapSource.indexOf('Administración'));
        expect(tablesSource).toContain('themeControl={<KitchenNotificationBell inline />}');
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
        expect(operationSource).toContain('variant="modal"');
        expect(operationSource).toContain('Cuenta principal / mesa destino');
        expect(operationSource).toContain('initialTableId');
        expect(tablesSource).toContain('initialTableId={operationTableId}');
        expect(operationSource).not.toContain('<select');
        expect(mapSource).toContain('Select<SelectOption>');
        expect(operationSource).toContain('Buscar por mesa o salón');
        expect(operationSource).toContain('visibleConsolidationSources');
    });

    it('keeps a single orders view without the removed Cuenta tab', () => {
        expect(panelSource).toContain('Órdenes activas');
        expect(panelSource).not.toContain('orders-section-heading');
        expect(panelSource).not.toContain("useState<'orders' | 'bill'>");
        expect(panelSource).not.toContain('role="tablist"');
    });

    it('uses a full-height, non-overflowing mobile order workspace', () => {
        expect(panelStyles).toContain('height: 100dvh');
        expect(panelStyles).toContain('grid-template-columns: minmax(0, 1fr) max-content');
        expect(panelStyles).toContain('overscroll-behavior: contain');
        expect(panelStyles).toContain('.orders-modal-footer .btn-modal-secondary:first-child { display: none; }');
        expect(panelStyles).toContain('.table-order-add-products { display: none !important; }');
        expect(panelStyles).toContain('env(safe-area-inset-bottom)');
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
