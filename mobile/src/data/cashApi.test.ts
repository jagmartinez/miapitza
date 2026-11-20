import { createCashApi } from './cashApi';
import { CashError } from './cashTypes';
import { SessionChangedError } from './types';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const api = createCashApi({ http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    return { ...env, api };
}

describe('cashApi', () => {
    it('routes and payloads match the server contracts', async () => {
        const { api, seen, reply } = await setup();
        reply((req) => ({ data: { success: true, data: req.url.includes('cash-settings') ? { exchangeRateUsd: 36.62, tolerance: 1 } : {} } }));
        expect(await api.settings()).toEqual({ exchangeRateUsd: 36.62, tolerance: 1 });
        await api.registers();
        await api.activeStatus();
        await api.suggestedFloat(4);
        await api.summary(9);
        await api.report(9);
        await api.history({ registerId: 2, from: '2026-11-01', to: '2026-11-20' });
        await api.openShift({ cashRegisterId: 4, startAmount: 100 });
        await api.count(9, { bills: [], coins: [] });
        await api.previewClose(9, { endAmount: 0, bills: [], coins: [] });
        await api.close(9, { endAmount: 0, bills: [], coins: [] });
        expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
            'GET /cash-shifts/cash-settings',
            'GET /cash-registers',
            'GET /cash-shifts/active-status',
            'GET /cash-shifts/suggested-float',
            'GET /cash-shifts/9/summary',
            'GET /cash-arqueo/9/report',
            'GET /cash-shifts',
            'POST /cash-shifts/open',
            'POST /cash-arqueo/9/count',
            'POST /cash-arqueo/9/preview-close',
            'POST /cash-arqueo/9/close',
        ]);
        expect(seen[7].data).toEqual({ cashRegisterId: 4, startAmount: 100 });
    });

    it('movement maps reason into description and sends only keys the validator accepts', async () => {
        const { api, seen } = await setup();
        await api.addMovement(9, { type: 'OUT', amount: 50, documentType: 'RECIBO_GASTO', description: 'Hielo', reason: 'Compra urgente', documentNumber: 'R-1', supplierId: 3 });
        await api.addMovement(9, { type: 'IN', amount: 10, description: 'Cambio' });
        expect(seen[0].data).toEqual({ type: 'OUT', amount: 50, documentType: 'RECIBO_GASTO', description: 'Compra urgente: Hielo', documentNumber: 'R-1', supplierId: 3 });
        expect(seen[1].data).toEqual({ type: 'IN', amount: 10, description: 'Cambio' });
        expect(JSON.stringify(seen[0].data)).not.toContain('reason');
    });

    it('every mutation carries a key; ambiguous failure reuses it, a definitive one does not', async () => {
        const { api, seen, reply } = await setup();
        reply(() => ({ network: true }));
        await expect(api.openShift({ cashRegisterId: 4, startAmount: 100 })).rejects.toBeTruthy();
        reply(() => ({ status: 500 }));
        await expect(api.openShift({ cashRegisterId: 4, startAmount: 100 })).rejects.toBeTruthy();
        reply(() => ({}));
        await api.openShift({ cashRegisterId: 4, startAmount: 100 });
        expect(seen.every((s) => !!s.key)).toBe(true);
        expect(new Set(seen.map((s) => s.key)).size).toBe(1);
        reply(() => ({ status: 409, code: 'CASH_SHIFT_ALREADY_OPEN' }));
        await expect(api.openShift({ cashRegisterId: 4, startAmount: 100 })).rejects.toMatchObject({ code: 'CASH_SHIFT_ALREADY_OPEN' });
        reply(() => ({}));
        await api.openShift({ cashRegisterId: 4, startAmount: 100 });
        expect(seen[seen.length - 1].key).not.toBe(seen[0].key);
    });

    it('occupied register error exposes occupant name', async () => {
        const { api, reply } = await setup();
        reply(() => ({ status: 409, code: 'CASH_REGISTER_OCCUPIED', data: { message: 'Caja ocupada', occupiedBy: { id: 7, name: 'Ana' } } }));
        const err = await api.openShift({ cashRegisterId: 4, startAmount: 0 }).catch((e) => e);
        expect(err).toBeInstanceOf(CashError);
        expect(err).toMatchObject({ code: 'CASH_REGISTER_OCCUPIED', message: 'Caja ocupada' });
        expect(err.occupiedBy).toEqual({ id: 7, name: 'Ana' });
    });

    it('other server errors keep their typed code', async () => {
        const { api, reply } = await setup();
        reply(() => ({ status: 400, code: 'CASH_COUNT_MISMATCH' }));
        await expect(api.previewClose(9, { endAmount: 1, bills: [], coins: [] })).rejects.toMatchObject({ code: 'CASH_COUNT_MISMATCH' });
        reply(() => ({ status: 403, code: 'CASH_DIFF_EXCEEDS_TOLERANCE' }));
        await expect(api.close(9, { endAmount: 1, bills: [], coins: [] })).rejects.toMatchObject({ code: 'CASH_DIFF_EXCEEDS_TOLERANCE' });
        reply(() => ({ status: 500 })); // not a cash error: untouched
        await expect(api.registers()).rejects.not.toBeInstanceOf(CashError);
    });

    it('close retry after lost response resolves alreadyClosed', async () => {
        const { api, seen, reply } = await setup();
        reply(() => ({ network: true }));
        await expect(api.close(9, { endAmount: 5, bills: [], coins: [] })).rejects.toBeTruthy();
        reply(() => ({ status: 409, code: 'CASH_SHIFT_ALREADY_CLOSED', data: { closedByMe: true } }));
        expect(await api.close(9, { endAmount: 5, bills: [], coins: [] })).toEqual({ alreadyClosed: true });
        expect(seen[0].key).toBe(seen[1].key);
        // Someone else closed it: that is an error, not a success.
        reply(() => ({ status: 409, code: 'CASH_SHIFT_ALREADY_CLOSED', data: { closedByMe: false } }));
        await expect(api.close(9, { endAmount: 5, bills: [], coins: [] })).rejects.toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED', closedByMe: false });
    });

    it('successful close returns the shift', async () => {
        const { api, reply } = await setup();
        reply(() => ({ data: { success: true, data: { id: 9, endDate: 'x' } } }));
        expect(await api.close(9, { endAmount: 5, bills: [], coins: [] })).toEqual({ alreadyClosed: false, shift: { id: 9, endDate: 'x' } });
    });

    it('cash calls offline reject with requiere conexión and are never queued', async () => {
        const { api, setOnline, seen, db } = await setup();
        setOnline(false);
        const calls = [
            () => api.registers(),
            () => api.activeStatus(),
            () => api.settings(),
            () => api.openShift({ cashRegisterId: 1, startAmount: 1 }),
            () => api.addMovement(1, { type: 'IN', amount: 1, description: 'x' }),
            () => api.close(1, { endAmount: 0, bills: [], coins: [] }),
        ];
        for (const call of calls) {
            const err = await call().catch((e) => e);
            expect(err).toBeInstanceOf(CashError);
            expect(err.code).toBe('CASH_OFFLINE');
            expect(err.message).toMatch(/Requiere conexión/);
        }
        expect(seen).toHaveLength(0);
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('a call that finishes under another session is refused', async () => {
        const { api, sessions, reply } = await setup();
        reply(async () => {
            await sessions.save(sessionFor(2));
            return { data: { success: true, data: { id: 1 } } };
        });
        await expect(api.summary(9)).rejects.toBeInstanceOf(SessionChangedError);
        await sessions.save(sessionFor(1));
        await expect(api.openShift({ cashRegisterId: 1, startAmount: 1 })).rejects.toBeInstanceOf(SessionChangedError);
    });
});
