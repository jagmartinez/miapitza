import { buildClosePayload, buildCountBody, countedTotals, DENOMINATIONS, emptyBreakdown, expectedFromSummary, type Breakdown } from './cashMath';

/** The server rule, verbatim (server/src/services/cash-arqueo.service.ts:61-70). */
function serverTotal(b: { bills: { denomination: number; count: number }[]; coins: { denomination: number; count: number }[]; usdBills: { denomination: number; count: number }[] }, rate: number) {
    const billsTotal = b.bills.reduce((s, x) => s + x.denomination * x.count, 0);
    const coinsTotal = b.coins.reduce((s, x) => s + x.denomination * x.count, 0);
    const usdTotal = b.usdBills.reduce((s, x) => s + x.denomination * x.count, 0);
    const exchangeRate = usdTotal > 0 ? Number(rate) : rate || 0;
    return Math.round((billsTotal + coinsTotal + usdTotal * exchangeRate) * 100) / 100;
}

describe('cashMath', () => {
    it('counted total matches server rule for coins 0.25 and 0.5 and USD at 36.5', () => {
        const b: Breakdown = { nioBills: { '100': 2 }, nioCoins: { '0.25': 3, '0.5': 1, '1': 4 }, usdBills: { '20': 1, '1': 3 } };
        const t = countedTotals(b, 36.5);
        expect(t.nioBillsC).toBe(20000);
        expect(t.nioCoinsC).toBe(75 + 50 + 400);
        expect(t.usd).toBe(23);
        expect(t.usdInNioC).toBe(83950); // 23 * 36.5 = 839.50
        expect(t.totalC).toBe(20000 + 525 + 83950);
        expect(t.totalC / 100).toBe(serverTotal({ ...buildClosePayload(b, 36.5, ""), usdBills: buildClosePayload(b, 36.5, "").usdBills ?? [] }, 36.5));
    });

    it('endAmount equals denomination total to the cent', () => {
        // An awkward rate: the sum must still be what the server computes from the rows we send.
        for (const rate of [36.5, 36.6243, 36.555, 36.9999, 35.1234567]) {
            for (let seed = 1; seed <= 60; seed++) {
                const b = emptyBreakdown();
                DENOMINATIONS.nioBills.forEach((d, i) => (b.nioBills[String(d)] = (seed * (i + 3)) % 7));
                DENOMINATIONS.nioCoins.forEach((d, i) => (b.nioCoins[String(d)] = (seed * (i + 5)) % 11));
                DENOMINATIONS.usdBills.forEach((d, i) => (b.usdBills[String(d)] = (seed * (i + 2)) % 5));
                const p = buildClosePayload(b, rate, '');
                expect(Math.round(p.endAmount * 100)).toBe(Math.round(serverTotal({ bills: p.bills, coins: p.coins, usdBills: p.usdBills ?? [] }, rate) * 100));
                expect(Math.round(p.endAmount * 100)).toBe(countedTotals(b, rate).totalC);
            }
        }
    });

    it('builds the payload: no zero rows, trimmed notes, rate only with USD, forceClose only when set', () => {
        const b: Breakdown = { nioBills: { '50': 1, '20': 0 }, nioCoins: {}, usdBills: {} };
        const p = buildClosePayload(b, 36.5, '  ok  ');
        expect(p).toEqual({ endAmount: 50, bills: [{ denomination: 50, count: 1 }], coins: [], usdBills: [], notes: 'ok' });
        const withUsd = buildClosePayload({ ...b, usdBills: { '5': 2 } }, 36.5, '', true);
        expect(withUsd).toMatchObject({ endAmount: 50 + 365, exchangeRate: 36.5, forceClose: true });
        expect(withUsd.notes).toBeUndefined();
        expect(buildCountBody(b, 36.5)).toEqual({ bills: [{ denomination: 50, count: 1 }], coins: [], usdBills: [] });
    });

    it('invalid counts are treated as zero and USD without a rate adds nothing', () => {
        const b: Breakdown = { nioBills: { '100': -1, '50': 1.5 }, nioCoins: {}, usdBills: { '10': 1 } };
        expect(countedTotals(b, 0).totalC).toBe(0);
    });

    it('expectedFromSummary reads the expected amount and is null when the server redacted it', () => {
        const base = { startAmount: 1, totalIn: 0, totalOut: 0, grossSalesCash: 0, cashRefunds: 0, totalSalesCash: 0, otherIncome: 0, otherOutflows: 0, movementCount: 0 };
        expect(expectedFromSummary({ summary: { ...base, expectedBalance: 125.5 } })).toBe(125.5);
        expect(expectedFromSummary({ summary: base })).toBeNull(); // blind: never derived
        expect(expectedFromSummary(null)).toBeNull();
    });
});
