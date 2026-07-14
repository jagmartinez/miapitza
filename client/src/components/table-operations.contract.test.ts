import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tablesSource = read('../pages/Tables.tsx');
const panelSource = read('./TableOrdersModal.tsx');
const posSource = read('../pages/POS.tsx');
const paymentSource = read('./PaymentModal.tsx');
const ordersSource = read('../pages/Orders.tsx');
const mapSource = read('./TableMap.tsx');

describe('table operational center contract', () => {
    it('opens the real POS workspace with the selected table', () => {
        expect(tablesSource).toContain('initialTableId={posTable.id}');
        expect(tablesSource).toContain('embedded');
        expect(posSource).toContain('initialTableId?: number');
        expect(posSource).toContain('tables.find((candidate) => candidate.id === initialTableId)');
    });

    it('exposes order, invoice, payment and split actions from the table panel', () => {
        expect(panelSource).toContain('Abrir pedido / POS');
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

    it('renders named floor zones instead of an unstructured dot grid', () => {
        expect(mapSource).toContain("table.location?.trim() || 'Salón principal'");
        expect(mapSource).toContain('className={`table-map-zone tone-${zone.tone}`}');
    });
});
