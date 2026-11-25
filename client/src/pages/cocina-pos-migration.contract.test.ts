import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('Plan 04 task 6: cocina y POS en el design system', () => {
    it.each(['./Kitchen.tsx', './Catering.tsx', './CateringServices.tsx', './Promotions.tsx', './PedidosYaIntegration.tsx'])(
        '%s usa PageHeader',
        (file) => expect(read(file)).toContain('<PageHeader'),
    );

    it.each([
        './Kitchen.tsx', './POS.tsx', './Catering.tsx', './PedidosYaIntegration.tsx',
        '../components/OrderCart.tsx', '../components/PaymentModal.tsx', '../components/TicketPrintModal.tsx',
    ])('%s no importa react-select directamente', (file) => expect(read(file)).not.toMatch(/from\s+['"]react-select/));

    it('PedidosYa usa DataTable y no tablas crudas', () => {
        const src = read('./PedidosYaIntegration.tsx');
        expect(src).not.toMatch(/<table[\s>]/);
        expect(src).toContain('<DataTable<');
    });

    it('Kitchen agrupa por columnas Recibidas / En preparación / Listas con indicadores N/D', () => {
        const src = read('./Kitchen.tsx');
        for (const label of ['Recibidas', 'En preparación', 'Listas']) expect(src).toContain(label);
        expect(src).toContain("'N/D'");
        expect(src).toContain('summarizeKds(');
    });
});
