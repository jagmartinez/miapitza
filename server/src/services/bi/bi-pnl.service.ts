import { SettingService } from '../setting.service';
import { type BiFacts, type BiQuality, loadBiContext, pct, round2, totalsInInterval } from './bi-common';
import { resolveBiRange, type BiQuery } from './bi-range';

export interface BridgeStep {
    key: 'gross' | 'discounts' | 'net' | 'cogs' | 'grossMargin' | 'labor' | 'opex' | 'commissions' | 'operating';
    label: string;
    amount: number;
    kind: 'total' | 'negative';
    /** Only on `labor`: 'unavailable'/'partial' when payroll does not cover the range (amount excludes it, it is not a real 0). */
    quality?: BiQuality;
}

export interface ChannelRow {
    channel: string; label: string; netSales: number; sharePct: number; netMarginPct: number; avgTicket: number;
}

const CHANNEL_LABELS: Record<string, string> = { RESTAURANT: 'Salón', DELIVERY: 'Delivery', PEDIDOSYA: 'PedidosYa' };

/**
 * Bridge from gross sales to operating profit, in the order of the mockup. Negative steps carry
 * positive magnitudes: net = cogs + labor + opex + commissions + operating (discounts only bridge
 * gross to net). Definitions as in bi-common `totalsInInterval`.
 */
export async function getBiBridge(q: BiQuery, now: Date = new Date()): Promise<BridgeStep[]> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const { cur, goals } = await loadBiContext(q, timezone, range);
    const t = totalsInInterval(cur, range.from, range.to, goals.fixedMonthlyExpenses, timezone);
    const grossMargin = round2(t.netSales - t.costReal);
    const laborQuality: BiQuality = t.laborCoverage < 0.001 ? 'unavailable' : t.laborCoverage < 0.999 ? 'partial' : 'complete';
    return [
        { key: 'gross', label: 'Venta bruta', amount: t.grossSales, kind: 'total' },
        { key: 'discounts', label: 'Descuentos', amount: t.discounts, kind: 'negative' },
        { key: 'net', label: 'Venta neta', amount: t.netSales, kind: 'total' },
        { key: 'cogs', label: 'Costo de ventas', amount: t.costReal, kind: 'negative' },
        { key: 'grossMargin', label: 'Margen bruto', amount: grossMargin, kind: 'total' },
        { key: 'labor', label: 'Personal', amount: t.labor, kind: 'negative', ...(laborQuality !== 'complete' ? { quality: laborQuality } : {}) },
        { key: 'opex', label: 'Gastos operativos', amount: t.opex, kind: 'negative' },
        { key: 'commissions', label: 'Comisiones de canal', amount: t.commissions, kind: 'negative' },
        { key: 'operating', label: 'Utilidad operativa', amount: t.operatingProfit, kind: 'total' },
    ];
}

/**
 * Sales mix by channel inside [from, to). Channel net sales = orders - credit notes of that channel
 * (so channels add up to the net sales of the summary). Real cost is not recorded per channel: it is
 * allocated in proportion to the channel's sales. Net margin = (net - allocated cost - channel
 * commission) / net. A channel without orders is omitted.
 */
export function channelBreakdown(facts: BiFacts, from: Date, to: Date): ChannelRow[] {
    const within = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();
    const orders = facts.orders.filter((o) => within(o.at));
    const credits = facts.credits.filter((c) => within(c.at));
    const costReal = facts.costs.filter((c) => within(c.at)).reduce((a, c) => a + c.amount, 0);

    const acc = new Map<string, { sales: number; commission: number; orders: number }>();
    for (const o of orders) {
        const a = acc.get(o.channel) ?? { sales: 0, commission: 0, orders: 0 };
        a.sales += o.total; a.commission += o.commission; a.orders += 1;
        acc.set(o.channel, a);
    }
    for (const c of credits) {
        const a = acc.get(c.channel ?? 'RESTAURANT');
        if (a) a.sales -= c.total;
    }
    const totalSales = [...acc.values()].reduce((s, a) => s + a.sales, 0);
    const rows = [...acc.entries()].map(([channel, a]) => {
        const allocatedCost = totalSales > 0 ? costReal * (a.sales / totalSales) : 0;
        return {
            channel,
            label: CHANNEL_LABELS[channel] ?? channel,
            netSales: round2(a.sales),
            sharePct: totalSales > 0 ? round2((a.sales / totalSales) * 100) : 0,
            netMarginPct: a.sales > 0 ? pct(a.sales - allocatedCost - a.commission, a.sales) : 0,
            avgTicket: a.orders > 0 ? round2(a.sales / a.orders) : 0,
        };
    }).sort((x, y) => y.netSales - x.netSales);

    // Rounding must not break the 100 % total: the residual goes to the largest channel.
    if (rows.length > 0 && totalSales > 0) {
        const residual = round2(100 - rows.reduce((s, r) => s + r.sharePct, 0));
        rows[0].sharePct = round2(rows[0].sharePct + residual);
    }
    return rows;
}

export async function getBiChannels(q: BiQuery, now: Date = new Date()): Promise<ChannelRow[]> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const { cur } = await loadBiContext(q, timezone, range);
    return channelBreakdown(cur, range.from, range.to);
}
