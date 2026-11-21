import { describe, expect, it } from 'vitest';
import { fakeApi, pathOf } from '../../test/helpers';
import { appEvents } from '../../core/events';
import { createHrApi, HrError } from './hrApi';

const ok = (data: unknown, status = 200) => ({ status, data: { success: true, data } });

describe('hrApi', () => {
    it('sends Idempotency-Key stable per actionId', async () => {
        let fail = true;
        const { http, calls } = fakeApi((c) => {
            if (c.url === '/v1/hr/overtime/requests' && fail) {
                fail = false;
                return { status: 503, data: { message: 'x' } };
            }
            return ok({ id: 1 }, 201);
        });
        const api = createHrApi(http);
        const body = { date: '2026-11-20', requestedMinutes: 60, reason: 'cierre' };
        await expect(api.createOvertime(body, { actionId: 'a1' })).rejects.toBeInstanceOf(HrError);
        await api.createOvertime(body, { actionId: 'a1' });
        await api.createOvertime(body, { actionId: 'a2' });
        const keys = calls.map((c) => (c.headers as unknown as { get(k: string): string }).get('Idempotency-Key'));
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it('a definitive rejection starts a fresh key on the next try', async () => {
        let n = 0;
        const { http, calls } = fakeApi(() => (n++ === 0 ? { status: 400, data: { message: 'no', code: 'HR_X' } } : ok({ id: 1 })));
        const api = createHrApi(http);
        const err = await api.createOvertime({ date: 'd', requestedMinutes: 1, reason: 'r' }, { actionId: 'a' }).catch((e) => e);
        expect(err).toMatchObject({ code: 'HR_X', status: 400, isAmbiguous: false });
        await api.createOvertime({ date: 'd', requestedMinutes: 1, reason: 'r' }, { actionId: 'a' });
        const get = (i: number) => (calls[i].headers as unknown as { get(k: string): string }).get('Idempotency-Key');
        expect(get(1)).not.toBe(get(0));
    });

    it('drops remembered keys when the user changes', async () => {
        let fail = true;
        const { http, calls } = fakeApi(() => {
            if (fail) {
                fail = false;
                return { status: 503, data: {} };
            }
            return ok({ id: 1 });
        });
        const api = createHrApi(http);
        const b = { date: 'd', requestedMinutes: 1, reason: 'r' };
        await api.createOvertime(b, { actionId: 'a' }).catch(() => undefined);
        appEvents.emit('account-user-changed');
        await api.createOvertime(b, { actionId: 'a' });
        const get = (i: number) => (calls[i].headers as unknown as { get(k: string): string }).get('Idempotency-Key');
        expect(get(1)).not.toBe(get(0));
        api.dispose();
    });

    it('punch/enroll use 45 s timeout', async () => {
        const { http, calls } = fakeApi(() => ok({ decision: 'ACCEPTED' }, 201));
        const api = createHrApi(http);
        const form = new FormData();
        await api.punch(form, { actionId: 'p' });
        await api.enroll(form, { actionId: 'e' });
        expect(calls[0].timeout).toBe(45_000);
        expect(calls[1].timeout).toBe(45_000);
        expect(pathOf(calls[0])).toBe('POST /v1/hr/attendance/punches');
        expect(pathOf(calls[1])).toBe('POST /v1/hr/biometrics/enroll');
    });

    it('receiptPdf requests blob', async () => {
        const { http, calls } = fakeApi(() => ({ data: new Blob(['%PDF']) }));
        const blob = await createHrApi(http).receiptPdf(5);
        expect(calls[0].responseType).toBe('blob');
        expect(pathOf(calls[0])).toBe('GET /v1/hr/payroll/me/receipts/5/pdf');
        expect(blob).toBeInstanceOf(Blob);
    });

    it('createLeave creates a draft then submits it', async () => {
        const { http, calls } = fakeApi((c) => ok({ id: 9, status: c.url!.endsWith('/submit') ? 'PENDING' : 'DRAFT' }));
        const out = await createHrApi(http).createLeave(
            { leaveTypeId: 1, startDate: '2026-12-01', endDate: '2026-12-02', fraction: 'FULL_DAY', reason: 'viaje' },
            { actionId: 'l' },
        );
        expect(calls.map(pathOf)).toEqual(['POST /v1/hr/leave/requests', 'POST /v1/hr/leave/requests/9/submit']);
        expect(out.status).toBe('PENDING');
    });

    it('swaps send no Idempotency-Key; loan cancel sends one', async () => {
        const { http, calls } = fakeApi(() => ok({ id: 1 }));
        const api = createHrApi(http);
        await api.createSwap({ requesterShiftId: 1, targetUserId: 2 });
        await api.cancelLoanRequest(3, 'ya no');
        const h = (i: number) => (calls[i].headers as unknown as { get(k: string): string | null }).get('Idempotency-Key');
        expect(h(0)).toBeFalsy();
        expect(h(1)).toBeTruthy();
        expect(pathOf(calls[1])).toBe('POST /v1/hr/benefits/me/loan-requests/3/cancel');
    });

    it('HrError carries Spanish server message', async () => {
        const { http } = fakeApi(() => ({ status: 409, data: { message: 'Saldo insuficiente', code: 'HR_VACATION_INSUFFICIENT_BALANCE' } }));
        const err = await createHrApi(http).loanPolicy().catch((e) => e);
        expect(err).toBeInstanceOf(HrError);
        expect(err.message).toContain('Saldo insuficiente');
        expect(err.code).toBe('HR_VACATION_INSUFFICIENT_BALANCE');
        expect(err.isAmbiguous).toBe(true);
    });

    it('mySchedule returns null for unpublished week', async () => {
        const { http } = fakeApi(() => ok(null));
        expect(await createHrApi(http).mySchedule('2026-11-16')).toBeNull();
    });

    it('retry after failed submit reuses the draft', async () => {
        let submits = 0;
        const { http, calls } = fakeApi((c) => {
            if (String(c.url).endsWith('/submit')) return submits++ === 0 ? { status: 503, data: {} } : ok({ id: 9, status: 'PENDING' });
            return ok({ id: 9, status: 'DRAFT' });
        });
        const api = createHrApi(http);
        const body = { leaveTypeId: 1, startDate: '2026-12-01', endDate: '2026-12-02', fraction: 'FULL_DAY' as const, reason: 'viaje' };
        await expect(api.createLeave(body, { actionId: 'l' })).rejects.toBeInstanceOf(HrError);
        const out = await api.createLeave(body, { actionId: 'l' });
        expect(out.status).toBe('PENDING');
        expect(calls.map(pathOf).filter((x) => x === 'POST /v1/hr/leave/requests')).toHaveLength(1);
    });

    it('authMe reads the PIN flags from /auth/me', async () => {
        const { http, calls } = fakeApi(() => ok({ id: 1, hasPin: true, canUsePin: false }));
        const me = await createHrApi(http).authMe();
        expect(calls[0].url).toBe('/auth/me');
        expect(me).toMatchObject({ hasPin: true, canUsePin: false });
    });

    it('receiptPdf surfaces the server message from a Blob error body', async () => {
        const { http } = fakeApi(() => ({ status: 404, data: new Blob([JSON.stringify({ message: 'Recibo no disponible' })], { type: 'application/json' }) }));
        const err = await createHrApi(http).receiptPdf(1).catch((e) => e);
        expect(err).toBeInstanceOf(HrError);
        expect(err.message).toBe('Recibo no disponible');
    });

    it('receiptPdf rejects a 2xx JSON body instead of returning it as a file', async () => {
        const { http } = fakeApi(() => ({ status: 200, data: new Blob([JSON.stringify({ message: 'Sin PDF' })], { type: 'application/json' }) }));
        await expect(createHrApi(http).receiptPdf(1)).rejects.toThrow('Sin PDF');
    });
});

describe('hrApi approvals', () => {
    const keyOf = (c: { headers?: unknown }) => (c.headers as unknown as { get(k: string): string }).get('Idempotency-Key');

    it('lists pending items with the status filter', async () => {
        const { http, calls } = fakeApi(() => ok([]));
        const api = createHrApi(http);
        await api.pendingLeave();
        await api.pendingOvertime();
        await api.pendingCorrections();
        await api.pendingSwaps();
        expect(calls.map(pathOf)).toEqual([
            'GET /v1/hr/leave/requests',
            'GET /v1/hr/overtime/requests',
            'GET /v1/hr/attendance/corrections',
            'GET /v1/hr/swaps',
        ]);
        expect(calls.map((c) => c.params.status)).toEqual(['PENDING', 'PENDING', 'PENDING', 'ACCEPTED']);
        expect(calls[0].params.limit).toBe(100);
    });

    it('decide bodies carry decision, reason and approvedMinutes with a stable key per action', async () => {
        let fail = true;
        const { http, calls } = fakeApi((c) => {
            if (String(c.url).includes('/overtime/') && fail) {
                fail = false;
                return { status: 503, data: { message: 'x' } };
            }
            return ok({ id: 1 });
        });
        const api = createHrApi(http);
        await api.decideLeave(5, 'REJECTED', 'sin cupo', { actionId: 'l' });
        await api.decideCorrection(6, 'APPROVED', 'Aprobado', { actionId: 'c' });
        await expect(api.decideOvertime(7, 'APPROVED', 30, 'Aprobado', { actionId: 'o' })).rejects.toBeInstanceOf(HrError);
        await api.decideOvertime(7, 'APPROVED', 30, 'Aprobado', { actionId: 'o' });
        expect(pathOf(calls[0])).toBe('POST /v1/hr/leave/requests/5/decide');
        expect(JSON.parse(calls[0].data)).toEqual({ decision: 'REJECTED', reason: 'sin cupo' });
        expect(pathOf(calls[1])).toBe('POST /v1/hr/attendance/corrections/6/decide');
        expect(JSON.parse(calls[2].data)).toEqual({ decision: 'APPROVED', approvedMinutes: 30, reason: 'Aprobado' });
        expect(keyOf(calls[3])).toBe(keyOf(calls[2]));
    });

    it('approves and rejects swaps without a key', async () => {
        const { http, calls } = fakeApi(() => ok({ id: 1 }));
        const api = createHrApi(http);
        await api.approveSwap(9, 'ok');
        await api.rejectSwap(9);
        expect(pathOf(calls[0])).toBe('POST /v1/hr/swaps/9/approve');
        expect(JSON.parse(calls[0].data)).toEqual({ notes: 'ok' });
        expect(pathOf(calls[1])).toBe('POST /v1/hr/swaps/9/manager-cancel');
        expect(keyOf(calls[0])).toBeFalsy();
    });
});
