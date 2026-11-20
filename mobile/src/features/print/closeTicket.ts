import type { ShiftReport } from '../../data/cashTypes';
import { reportView } from '../cash/reportModel';

/** 80 mm thermal paper, monospaced font: 48 columns. */
export const TICKET_WIDTH = 48;

/**
 * Character policy. The printer prints a Latin code page (CP850/858), so the ticket keeps printable ASCII plus the
 * Spanish letters ñ Ñ á é í ó ú Á É Í Ó Ú and the middle dot of the footer (all in CP850). Everything else is
 * transliterated: typographic quotes and dashes to their ASCII form, other accented letters to the base letter
 * (ü -> u, ç -> c), control characters (tab, newline) to a space; anything left (emoji, symbols) becomes "?".
 * It works by code point, so one emoji is one column. `String.length` of the result is the printed width.
 */
const KEEP = new Set([...'ñÑáéíóúÁÉÍÓÚ·']);
const MAP: Record<string, string> = { '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '–': '-', '—': '-', '−': '-', '…': '.', '×': 'x', '€': 'E' };

export function ticketText(input: string): string {
    let out = '';
    // Composed form first, so a decomposed "e + accent" survives as one allowed letter.
    for (const ch of String(input ?? '').normalize('NFC')) {
        if (KEEP.has(ch) || (ch >= ' ' && ch <= '~')) out += ch;
        else if (MAP[ch]) out += MAP[ch];
        else if (/\s/.test(ch) || ch < ' ' || ch === '\u007f') out += ' ';
        else {
            const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
            out += base.length === 1 && base >= ' ' && base <= '~' ? base : '?';
        }
    }
    return out;
}

/** Group thousands and always show two decimals; no locale involved, so the ticket is identical on every device. */
const num = (value: number) => {
    const v = Number.isFinite(value) ? value : 0; // a malformed amount prints 0.00, never NaN
    const sign = v < 0 ? '-' : '';
    const [whole, dec] = Math.abs(v).toFixed(2).split('.');
    return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
};
const nio = (v: number) => `C$ ${num(v)}`;
const usd = (v: number) => `US$ ${num(v)}`;
const whole = (v: number) => (Number.isInteger(v) ? num(v).slice(0, -3) : Number.isFinite(v) ? String(v) : '0');

const pad2 = (n: number) => String(n).padStart(2, '0');
const stamp = (value: Date | string | null | undefined): string => {
    const d = value instanceof Date ? value : value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '-';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const clip = (text: string, width: number) => ticketText(text).slice(0, Math.max(0, width));
const center = (text: string) => {
    const t = clip(text, TICKET_WIDTH);
    return ' '.repeat(Math.floor((TICKET_WIDTH - t.length) / 2)) + t;
};
/** Label on the left, value on the right; a long label is cut (never the value) so the row stays within 48. */
const row = (label: string, value = '') => {
    const v = clip(value, TICKET_WIDTH);
    const l = clip(label, TICKET_WIDTH - v.length - (v ? 1 : 0));
    return l + ' '.repeat(l ? Math.max(1, TICKET_WIDTH - l.length - v.length) : Math.max(0, TICKET_WIDTH - v.length)) + v;
};
/** Word wrap to the width; a word longer than a line is cut into pieces. */
function wrap(text: string, indent = '', width = TICKET_WIDTH): string[] {
    const room = width - indent.length;
    const lines: string[] = [];
    let line = '';
    for (const raw of ticketText(text).split(' ').filter(Boolean)) {
        let word = raw;
        while (word.length > room) {
            if (line) {
                lines.push(line);
                line = '';
            }
            lines.push(word.slice(0, room));
            word = word.slice(room);
        }
        if (line && line.length + 1 + word.length > room) {
            lines.push(line);
            line = word;
        } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines.map((l) => indent + l);
}

const RULE = '-'.repeat(TICKET_WIDTH);

export interface TicketOptions {
    /** When it is printed (footer). Defaults to now. */
    printedAt?: Date;
    /** Who prints it (footer). */
    printedBy?: string;
}

/** The closing ticket (spec 7.3.2b) as plain text: pure, every line at most 48 characters. */
export function closeTicket(report: ShiftReport, opts: TicketOptions = {}): string {
    const v = reportView(report);
    const h = report.header;
    const out: string[] = [];
    const add = (...lines: string[]) => out.push(...lines);

    if (h) {
        add(center(h.companyName), center(h.branchName));
        if (h.branchAddress) wrap(h.branchAddress).forEach((l) => add(center(l)));
        if (h.branchPhone) add(center(`Tel: ${h.branchPhone}`));
        if (h.ruc) add(center(`RUC: ${h.ruc}`));
    }
    add(RULE, center('CIERRE DE CAJA'), RULE);
    add(row('Caja:', v.register), row('Turno:', v.shiftNo != null ? `#${v.shiftNo}` : '-'), row('Cajero:', v.cashier), row('Apertura:', stamp(v.start)), row('Cierre:', stamp(v.end)));

    add(RULE, 'VENTAS');
    if (v.sales) {
        add(row('  Efectivo', nio(v.sales.cash)), row('  Tarjeta', nio(v.sales.card)), row('  Transferencia', nio(v.sales.transfer)), row('TOTAL VENTAS', nio(v.salesTotal ?? 0)), row('  Cobros', String(v.sales.paymentCount)));
    } else add(row('  Efectivo', nio(v.cashSales)));
    if (v.discounts != null) add(row('  Descuentos', nio(v.discounts)));
    if (v.tips != null) add(row('  Propinas', nio(v.tips)));

    add(RULE, 'EFECTIVO C$', row('  Fondo inicial', nio(v.startAmount)), row('  Ventas en efectivo', nio(v.cashSales)), row('  Entradas', nio(v.moneyIn)), row('  Salidas', `-${nio(v.moneyOut)}`));
    if (v.refunds > 0) add(row('  Devoluciones', `-${nio(v.refunds)}`));
    add(row('DEBE HABER', v.expected != null ? nio(v.expected) : '-'));

    add(RULE, 'ARQUEO');
    if (v.rate != null) add(row('  Tipo de cambio', `C$ ${num(v.rate)} x US$`));
    if (v.bills.length || v.coins.length) {
        add('Córdobas');
        [...v.bills, ...v.coins].forEach((r) => add(row(`  ${whole(r.denomination)} x ${r.count}`, num(r.denomination * r.count))));
        add(row('  Subtotal C$', nio(v.nioCounted)));
    }
    if (v.usdBills.length) {
        add('Dólares');
        v.usdBills.forEach((r) => add(row(`  US$ ${whole(r.denomination)} x ${r.count}`, usd(r.denomination * r.count))));
        add(row('  Total US$', usd(v.usd)), row(`  Equivale en C$${v.rate != null ? ` (TC ${num(v.rate)})` : ''}`, nio(v.usdInNio)));
    }
    add(row('CONTADO', v.counted != null ? nio(v.counted) : '-'));
    if (v.difference != null && v.status) {
        const amount = Math.abs(v.difference);
        add(row('DIFERENCIA', v.status === 'CUADRADO' ? 'CUADRADO' : `${v.status} ${nio(amount)}`));
        if (v.status !== 'CUADRADO' && v.rate) add(row('', `(equivale a ${usd(amount / v.rate)})`));
    }
    if (v.notes) wrap(`Nota: ${v.notes}`).forEach((l) => add(l));

    add('', '', '_'.repeat(20) + ' '.repeat(8) + '_'.repeat(20), 'Cajero' + ' '.repeat(22) + 'Supervisor', '');
    // "Impreso <fecha> <hora> · <usuario>": the user is cut, never the date.
    const base = `Impreso ${stamp(opts.printedAt ?? new Date())} · `;
    add(base + clip(opts.printedBy ?? '', TICKET_WIDTH - base.length));
    return out.join('\n');
}
