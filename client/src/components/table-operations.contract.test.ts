import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tablesSource = read('../pages/Tables.tsx');
const panelSource = read('./TableOrdersModal.tsx');
const posSource = read('../pages/POS.tsx');
const paymentSource = read('./PaymentModal.tsx');
const ordersSource = read('../pages/Orders.tsx');
const mapSource = read('./TableMap.tsx');
const operationSource = read('./TableOperationModal.tsx');
const kitchenSource = read('../pages/Kitchen.tsx');
const layoutSource = read('./Layout.tsx');
const bellSource = read('./KitchenNotificationBell.tsx');

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
        expect(tablesSource.indexOf('invoicesAPI.getData(order.id)')).toBeLessThan(
            tablesSource.indexOf("setPaymentMode(mode)")
        );
        expect(ordersSource.indexOf('await invoicesAPI.getData(order.id)')).toBeLessThan(
            ordersSource.indexOf('setShowPaymentModal(true)')
        );
    });

    it('renders editable persisted floor areas and table geometry', () => {
        expect(mapSource).toContain('plan.areas.map(normalizeArea)');
        expect(mapSource).toContain('Agregar salón');
        expect(mapSource).toContain("mapShape: 'ROUND'");
        expect(mapSource).toContain('Guardar plano');
        expect(tablesSource).toContain('tablesAPI.updateFloorPlan');
    });

    it('keeps operational actions and filters inside the full-screen map toolbar', () => {
        expect(mapSource).toContain('Todas las mesas');
        expect(mapSource).toContain('Cambiar mesa');
        expect(mapSource).toContain('Consolidar');
        expect(mapSource).toContain('Nueva mesa');
        expect(mapSource).toContain('onStatusFilterChange');
        expect(tablesSource).toContain('!showMap && <PageHeader');
        expect(tablesSource).toContain('branchControl=');
        expect(mapSource).not.toContain('<select');
        expect(mapSource).not.toContain('onShowList');
        expect(mapSource).not.toContain('<span>Estado</span>');
        expect(mapSource).toContain('canvas-resize-handle');
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
        expect(paymentSource).toContain('unit-stepper');
    });

    it('uses themed react-select controls throughout table operations', () => {
        expect(operationSource).toContain('variant="modal"');
        expect(operationSource).toContain('Cuenta principal / mesa destino');
        expect(operationSource).toContain('initialTableId');
        expect(tablesSource).toContain('initialTableId={operationTableId}');
        expect(operationSource).not.toContain('<select');
        expect(mapSource).toContain('Select<SelectOption>');
    });

    it('keeps a single orders view without the removed Cuenta tab', () => {
        expect(panelSource).toContain('Órdenes activas');
        expect(panelSource).not.toContain("useState<'orders' | 'bill'>");
        expect(panelSource).not.toContain('role="tablist"');
    });

    it('limits kitchen fullscreen and administration navigation to the KDS rules', () => {
        expect(kitchenSource).toContain("if (!displayMode) return");
        expect(kitchenSource).toContain('displayMode && canReturnToAdministration');
        expect(kitchenSource).not.toContain('kitchen-items-summary');
    });

    it('mounts the kitchen alert bell only inside Tables and announces new alerts', () => {
        expect(tablesSource).toContain('<KitchenNotificationBell inline />');
        expect(layoutSource).not.toContain('<KitchenNotificationBell');
        expect(bellSource).toContain('playNotificationSound()');
        expect(bellSource).toContain('navigator.vibrate');
    });
});
