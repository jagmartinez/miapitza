import { describe, expect, it } from '@jest/globals';

import { TicketPrintingService, type PrintableOrderTicket } from '../../services/ticket-printing.service';

const fixture: PrintableOrderTicket = {
    header: {
        businessName: 'Restaurante con nombre extremadamente largo para impresora térmica',
        ruc: 'J0310000000000',
        address: 'Dirección extensa\ncon salto inyectado y referencias adicionales',
        phone: '2222-2222',
        branch: 'Central',
        currency_symbol: 'C$',
        logoUrl: ''
    },
    order: {
        financialStatus: 'PAID',
        number: '000123',
        date: new Date('2026-07-14T12:00:00.000Z'),
        type: 'DINE_IN',
        table: 'Mesa principal con identificador largo',
        waiter: 'Operador de caja con nombre largo',
        customerName: 'Cliente\r\ncon control de línea'
    },
    items: [{
        name: 'Pizza familiar con una descripción que supera cualquier ancho de papel',
        quantity: 2,
        price: 150,
        subtotal: 300,
        modifiers: [{ name: 'Extra queso con descripción prolongada', price: 25 }]
    }],
    totals: { subtotal: 300, discount: 0, discountCode: null, tip: 0, tax: 45, total: 345 },
    payments: [{ method: 'Tarjeta de crédito', amount: 345, reference: 'AUTH-1' }],
    footer: { message: 'Gracias por su visita y vuelva pronto a nuestra sucursal principal', printedAt: '' }
};

describe.each([
    [58, 32],
    [80, 48]
] as const)('Thermal printer %imm contract', (width, columns) => {
    it('sanitizes control characters and never exceeds the physical column budget', () => {
        const output = TicketPrintingService.formatForPrinter(fixture, width);
        const lines = output.split('\n');

        expect(lines.length).toBeGreaterThan(10);
        expect(output).toContain('TOTAL:');
        expect(Array.from(output).every((character) => {
            const code = character.charCodeAt(0);
            return character === '\n' || (code >= 32 && code !== 127);
        })).toBe(true);
        expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(columns);
    });
});
