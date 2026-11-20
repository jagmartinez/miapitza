import { closeTicket, TICKET_WIDTH, ticketText } from './closeTicket';
import { reportOf, SALES } from './reportFixture';

const opts = { printedAt: new Date(2026, 10, 21, 9, 5), printedBy: 'Carla Cajera', sales: SALES };

describe('closeTicket', () => {
    it('every ticket line is at most 48 chars', () => {
        const long = 'Z'.repeat(120);
        const report = reportOf({
            header: { companyName: `Compañía ${long}`, ruc: long, branchName: long, branchAddress: long, branchPhone: long },
            shift: { cashRegister: long, user: `Ñandú ${long}`, notes: `${long} ${'palabra '.repeat(30)}` },
            amounts: { startAmount: 123456789.5, expectedEndAmount: 987654321.25, actualEndAmount: 987654326.25 },
        });
        for (const text of [closeTicket(report, opts), closeTicket(reportOf(), opts), closeTicket(reportOf(), { ...opts, printedBy: long })]) {
            for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(TICKET_WIDTH);
        }
        expect(TICKET_WIDTH).toBe(48);
    });

    it('ticket shows SOBRANTE or FALTANTE with amount and both currencies', () => {
        const over = closeTicket(reportOf(), opts);
        expect(over).toMatch(/SOBRANTE C\$ 5\.00/);
        expect(over).toContain('US$');
        expect(over).toMatch(/US\$ 43\.00/); // 2 x 20 + 3 x 1 counted dollars
        expect(over).toMatch(/36\.50/);
        const short = closeTicket(reportOf({ amounts: { actualEndAmount: 2415.5, difference: -5 } }), opts);
        expect(short).toMatch(/FALTANTE C\$ 5\.00/);
        expect(short).not.toContain('SOBRANTE');
        const even = closeTicket(reportOf({ amounts: { actualEndAmount: 2420.5, difference: 0 } }), opts);
        expect(even).toContain('CUADRADO');
    });

    it('ticket header has company RUC and branch', () => {
        const lines = closeTicket(reportOf(), opts).split('\n');
        expect(lines.slice(0, 6).join('\n')).toContain('Mia Pitza S.A.');
        expect(lines.slice(0, 6).join('\n')).toContain('RUC: J0310000000001');
        expect(lines.slice(0, 6).join('\n')).toContain('Sucursal Centro');
    });

    it('follows the spec section order with hyphen separators, signature lines and the footer', () => {
        const text = closeTicket(reportOf(), opts);
        const at = (s: string) => text.indexOf(s);
        const order = ['CIERRE DE CAJA', 'VENTAS', 'EFECTIVO C$', 'DEBE HABER', 'ARQUEO', 'CONTADO', 'DIFERENCIA', 'Nota:', '____', 'Supervisor', 'Impreso'];
        order.forEach((s) => expect(at(s)).toBeGreaterThan(-1));
        for (let i = 1; i < order.length; i++) expect(at(order[i])).toBeGreaterThan(at(order[i - 1]));
        expect(text).toContain('-'.repeat(48));
        expect(text).toContain('_'.repeat(20));
        expect(text.trimEnd().split('\n').pop()).toBe('Impreso 21/11/2026 09:05 · Carla Cajera');
    });

    it('keeps only printable ASCII plus the Spanish letters (policy)', () => {
        expect(ticketText('Ñandú “Café” – ✓ Zürich 😀\tok')).toBe('Ñandú "Café" - ? Zurich ? ok');
        const text = closeTicket(reportOf({ shift: { user: 'Ana 🍕 Müller' } }), opts);
        expect(text).not.toMatch(/[^\x20-\x7E\nñÑáéíóúÁÉÍÓÚ·]/);
    });
});
