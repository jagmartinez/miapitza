import type { ClosePayload, CountRow, ShiftSummary } from '../../data/cashTypes';

/** Denominations of the arqueo (same as the web CashShift page). USD has no coins. */
export const DENOMINATIONS = {
    nioBills: [1000, 500, 200, 100, 50, 20, 10],
    nioCoins: [10, 5, 1, 0.5, 0.25],
    usdBills: [100, 50, 20, 10, 5, 1],
} as const;

/** Counts keyed by denomination. Missing = 0. */
export type CountMap = Record<string, number>;

export interface Breakdown {
    nioBills: CountMap;
    nioCoins: CountMap;
    usdBills: CountMap;
}

export const emptyBreakdown = (): Breakdown => ({ nioBills: {}, nioCoins: {}, usdBills: {} });

export interface CountedTotals {
    nioBillsC: number;
    nioCoinsC: number;
    /** Whole US$ (bills only). */
    usd: number;
    usdInNioC: number;
    /** Counted total in cents: exactly what the server computes. */
    totalC: number;
}

/** A count is a whole number >= 0; anything else counts as 0 (the keypad never produces it). */
const cnt = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0);

/** Sum of denomination * count as a float, like the server. Every term is a multiple of 0.25, so it is exact in binary. */
function sumFloat(map: CountMap | undefined): number {
    let total = 0;
    for (const [d, n] of Object.entries(map ?? {})) {
        const denom = Number(d);
        if (Number.isFinite(denom) && denom > 0) total += denom * cnt(n);
    }
    return total;
}

const toCents = (v: number) => Math.round(v * 100);

/**
 * Mirrors CashArqueoService.calculateCountedAmount (server/src/services/cash-arqueo.service.ts:41-72):
 * billsTotal + coinsTotal + usdTotal * rate (:63-66), rounded once to the cent (:70).
 * The same float expression is used for totalC so it equals the server's cent.
 */
export function countedTotals(breakdown: Breakdown, rate: number): CountedTotals {
    const bills = sumFloat(breakdown.nioBills);
    const coins = sumFloat(breakdown.nioCoins);
    const usd = sumFloat(breakdown.usdBills);
    const effectiveRate = usd > 0 && Number.isFinite(rate) && rate > 0 ? rate : 0;
    const usdInNio = usd * effectiveRate;
    return {
        nioBillsC: toCents(bills),
        nioCoinsC: toCents(coins),
        usd,
        usdInNioC: toCents(usdInNio),
        totalC: Math.round((bills + coins + usdInNio) * 100),
    };
}

const rows = (map: CountMap | undefined): CountRow[] =>
    Object.entries(map ?? {})
        .map(([d, n]) => ({ denomination: Number(d), count: cnt(n) }))
        .filter((r) => Number.isFinite(r.denomination) && r.denomination > 0 && r.count > 0)
        .sort((a, b) => b.denomination - a.denomination);

/** Body for count / preview-close / close. `endAmount` is the denomination total to the cent (the server rejects any mismatch). */
export function buildClosePayload(breakdown: Breakdown, rate: number, notes: string, forceClose = false): ClosePayload {
    const totals = countedTotals(breakdown, rate);
    const payload: ClosePayload = {
        endAmount: totals.totalC / 100,
        bills: rows(breakdown.nioBills),
        coins: rows(breakdown.nioCoins),
        usdBills: rows(breakdown.usdBills),
    };
    if (totals.usd > 0) payload.exchangeRate = rate; // the server stores it only when USD was counted
    const trimmed = notes.trim();
    if (trimmed) payload.notes = trimmed;
    if (forceClose) payload.forceClose = true;
    return payload;
}

/** Same breakdown as rows, for `cashApi.count` (no endAmount / notes). */
export function buildCountBody(breakdown: Breakdown, rate: number) {
    const { endAmount: _e, notes: _n, forceClose: _f, ...body } = buildClosePayload(breakdown, rate, '');
    void _e;
    void _n;
    void _f;
    return body;
}

/**
 * Expected cash in the drawer from a summary, in córdobas. ADMIN/SUPERADMIN only: for a blind cashier the server omits
 * the field and this returns null (it is never derived from the other amounts).
 */
export function expectedFromSummary(data: Pick<ShiftSummary, 'summary'> | ShiftSummary['summary'] | null | undefined): number | null {
    const s = data && 'summary' in data ? data.summary : data;
    const v = s?.expectedBalance ?? s?.expectedAmount;
    return typeof v === 'number' && Number.isFinite(v) ? toCents(v) / 100 : null;
}
