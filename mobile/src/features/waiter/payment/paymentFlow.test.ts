import { cashChange, createPaymentFlow, evenLegAmounts, LegError, matchPaidLegs, quickAmounts, type FlowApi, type Leg } from './paymentFlow';

const ok = (over: Record<string, unknown> = {}) => ({ data: { id: 1 }, fiscalInvoice: null, fiscalInvoiceError: null, ...over });
const httpError = (status: number, message = 'x') => Object.assign(new Error(String(status)), { response: { status, data: { message } } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

function makeFlowApi(over: Partial<Record<keyof FlowApi, unknown>> = {}) {
    return {
        pricing: vi.fn().mockResolvedValue({}),
        updateFiscalCustomer: vi.fn().mockResolvedValue({}),
        preinvoice: vi.fn().mockResolvedValue({ invoiceNumber: 'PRE-1' }),
        paymentSummary: vi.fn().mockResolvedValue({ remaining: 230 }),
        payLeg: vi.fn().mockResolvedValue(ok()),
        ...over,
    } as unknown as { [K in keyof FlowApi]: FlowApi[K] & ReturnType<typeof vi.fn> };
}

const leg = (id: string, amount: number, over: Partial<Leg> = {}): Leg => ({ id, paymentMethodId: 1, amount, ...over });

describe('cash helpers', () => {
    it('cash change is computed from received', () => {
        expect(cashChange(500, 230)).toBe(270);
        expect(cashChange(230, 230)).toBe(0);
        expect(cashChange(100, 230)).toBe(0); // short: no change (and the charge is blocked elsewhere)
        expect(cashChange(0.3, 0.1)).toBe(0.2); // integer cents, no float noise
    });

    it('quick amounts are Exacto plus the next round bills above the balance', () => {
        expect(quickAmounts(230)).toEqual([230, 250, 300, 500]);
        expect(quickAmounts(1000)).toEqual([1000]); // already a round bill
        expect(quickAmounts(50)).toEqual([50, 100, 500, 1000]);
    });
});

describe('createPaymentFlow.prepare', () => {
    it('preinvoice is called once even on retry', async () => {
        const api = makeFlowApi({ payLeg: vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok()) });
        const flow = createPaymentFlow({ api, orderId: 5 });
        await flow.prepare({ customer: null });
        await expect(flow.pay([leg('a', 230)])).rejects.toBeInstanceOf(LegError);
        await flow.prepare({ customer: null }); // the retry of "Cobrar" prepares again
        await flow.pay([leg('a', 230)]);
        expect(api.preinvoice).toHaveBeenCalledTimes(1);
        expect(api.pricing).not.toHaveBeenCalled();
        expect(api.updateFiscalCustomer).not.toHaveBeenCalled();
    });

    it('retries only the step that failed', async () => {
        const api = makeFlowApi({ preinvoice: vi.fn().mockRejectedValueOnce(httpError(500)).mockResolvedValue({}) });
        const flow = createPaymentFlow({ api, orderId: 5 });
        const input = { customer: { customerName: 'Ana', customerTaxId: 'J1', customerTaxIdType: 'RUC' } };
        await flow.setTip(15);
        await flow.setTip(15); // same value: nothing to write
        await expect(flow.prepare(input)).rejects.toBeTruthy();
        await flow.prepare(input);
        expect(api.pricing).toHaveBeenCalledTimes(1);
        expect(api.pricing).toHaveBeenCalledWith(5, { tipAmount: 15 });
        expect(api.updateFiscalCustomer).toHaveBeenCalledTimes(1);
        expect(api.preinvoice).toHaveBeenCalledTimes(2);
    });

    it('a customer changed after a successful PATCH and a failed preinvoice is sent again before the retry', async () => {
        const api = makeFlowApi({ preinvoice: vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue({}) });
        const flow = createPaymentFlow({ api, orderId: 5 });
        await expect(flow.prepare({ customer: { customerName: 'Ana' } })).rejects.toBeTruthy();
        await flow.prepare({ customer: { customerName: 'Beto' } });
        expect(api.updateFiscalCustomer.mock.calls.map((c) => c[1])).toEqual([{ customerName: 'Ana' }, { customerName: 'Beto' }]);
        expect(api.preinvoice).toHaveBeenCalledTimes(2);
        expect(api.updateFiscalCustomer.mock.invocationCallOrder[1]).toBeLessThan(api.preinvoice.mock.invocationCallOrder[1]);
    });

    it('an unchanged customer is not sent twice', async () => {
        const api = makeFlowApi({ preinvoice: vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue({}) });
        const flow = createPaymentFlow({ api, orderId: 5 });
        await expect(flow.prepare({ customer: { customerName: 'Ana' } })).rejects.toBeTruthy();
        await flow.prepare({ customer: { customerName: 'Ana' } });
        expect(api.updateFiscalCustomer).toHaveBeenCalledTimes(1);
    });

    it('skips everything when the order is already pre-invoiced', async () => {
        const api = makeFlowApi();
        const flow = createPaymentFlow({ api, orderId: 5, preinvoiced: true });
        await flow.prepare({ customer: { customerName: 'Ana' } });
        await expect(flow.setTip(10)).rejects.toThrow(/prefacturada/);
        expect(api.pricing).not.toHaveBeenCalled();
        expect(api.updateFiscalCustomer).not.toHaveBeenCalled();
        expect(api.preinvoice).not.toHaveBeenCalled();
    });
});

describe('createPaymentFlow.pay', () => {
    it('every leg has its own key and carries its payer name', async () => {
        const api = makeFlowApi();
        const flow = createPaymentFlow({ api, orderId: 5 });
        await flow.pay([leg('a', 100, { payerName: 'Ana' }), leg('b', 130, { payerName: 'Beto', reference: 'AUT-9' })]);
        const [first, second] = api.payLeg.mock.calls;
        expect(first[0]).toEqual({ orderId: 5, paymentMethodId: 1, amount: 100, payerName: 'Ana' });
        expect(second[0]).toEqual({ orderId: 5, paymentMethodId: 1, amount: 130, payerName: 'Beto', reference: 'AUT-9' });
        expect(first[1]).not.toBe(second[1]);
    });

    it('network drop after leg 2 retries only the pending leg, with the key of that leg', async () => {
        const payLeg = vi
            .fn()
            .mockResolvedValueOnce(ok())
            .mockResolvedValueOnce(ok())
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue(ok({ fiscalInvoice: { invoiceNumber: 'F-7' } }));
        const api = makeFlowApi({ payLeg });
        const flow = createPaymentFlow({ api, orderId: 5 });
        const legs = [leg('a', 50), leg('b', 80), leg('c', 100)];
        await expect(flow.pay(legs)).rejects.toMatchObject({ legId: 'c' });
        expect(flow.confirmedIds()).toEqual(['a', 'b']);
        const keyOfC = payLeg.mock.calls[2][1];
        const out = await flow.pay(legs);
        expect(payLeg).toHaveBeenCalledTimes(4); // a and b were not charged again
        expect(payLeg.mock.calls[3][0]).toMatchObject({ amount: 100 });
        expect(payLeg.mock.calls[3][1]).toBe(keyOfC);
        expect(out.fiscalInvoice).toMatchObject({ invoiceNumber: 'F-7' });
    });

    it('a 409 keeps the leg key and the leg pending; the server message reaches the caller', async () => {
        const payLeg = vi.fn().mockRejectedValueOnce(httpError(409, 'Pago en proceso')).mockResolvedValue(ok());
        const api = makeFlowApi({ payLeg });
        const flow = createPaymentFlow({ api, orderId: 5 });
        const err = await flow.pay([leg('a', 230)]).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(LegError);
        expect((err as LegError).cause).toMatchObject({ response: { status: 409 } });
        expect(flow.confirmedIds()).toEqual([]);
        await flow.pay([leg('a', 230)]);
        expect(payLeg.mock.calls[1][1]).toBe(payLeg.mock.calls[0][1]); // same key: the server answers with the first attempt
    });

    it('a definitive rejection (422) starts a fresh key; a changed amount never reuses the old key', async () => {
        const payLeg = vi.fn().mockRejectedValueOnce(httpError(422)).mockRejectedValueOnce(networkError()).mockResolvedValue(ok());
        const flow = createPaymentFlow({ api: makeFlowApi({ payLeg }), orderId: 5 });
        await flow.pay([leg('a', 100)]).catch(() => undefined);
        await flow.pay([leg('a', 100)]).catch(() => undefined);
        await flow.pay([leg('a', 90)]);
        const keys = payLeg.mock.calls.map((c) => c[1]);
        expect(keys[1]).not.toBe(keys[0]); // 422 -> new attempt
        expect(keys[2]).not.toBe(keys[1]); // network error kept key[1], but the payload changed
    });

    it('returns the fiscal invoice error of the last leg without failing the payment', async () => {
        const api = makeFlowApi({ payLeg: vi.fn().mockResolvedValue(ok({ fiscalInvoiceError: 'Sin secuencia fiscal' })) });
        const flow = createPaymentFlow({ api, orderId: 5 });
        const out = await flow.pay([leg('a', 230)]);
        expect(out).toMatchObject({ fiscalInvoice: null, fiscalInvoiceError: 'Sin secuencia fiscal' });
        expect(flow.confirmedIds()).toEqual(['a']);
    });

    it('two overlapping pay calls charge a leg once', async () => {
        let release!: () => void;
        const payLeg = vi.fn().mockImplementation(() => new Promise((r) => (release = () => r(ok()))));
        const flow = createPaymentFlow({ api: makeFlowApi({ payLeg }), orderId: 5 });
        const first = flow.pay([leg('a', 230)]);
        const second = flow.pay([leg('a', 230)]);
        await vi.waitFor(() => expect(payLeg).toHaveBeenCalledTimes(1));
        release();
        await Promise.allSettled([first, second]);
        expect(payLeg).toHaveBeenCalledTimes(1);
    });
});

describe('pending attempts and resume', () => {
    it('knows which legs hold a retained key after a lost response', async () => {
        const flow = createPaymentFlow({ api: makeFlowApi({ payLeg: vi.fn().mockRejectedValue(networkError()) }), orderId: 5 });
        await flow.pay([leg('a', 100)]).catch(() => undefined);
        expect(flow.hasPending(['a'])).toBe(true);
        expect(flow.hasPending(['b'])).toBe(false);
    });

    it('persists the key before the request leaves and resumes with it', async () => {
        const saved: { legs: Record<string, { key: string }>; confirmed: string[] }[] = [];
        const payLeg = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok());
        const flow = createPaymentFlow({ api: makeFlowApi({ payLeg }), orderId: 5, persist: (s) => void saved.push(JSON.parse(JSON.stringify(s))) });
        await flow.pay([leg('a', 100)]).catch(() => undefined);
        expect(saved[0].legs.a.key).toBe(payLeg.mock.calls[0][1]); // written first
        const api2 = makeFlowApi();
        const resumed = createPaymentFlow({ api: api2, orderId: 5, resume: saved[saved.length - 1] as never });
        expect(resumed.hasPending(['a'])).toBe(true);
        await resumed.pay([leg('a', 100)]);
        expect(api2.payLeg.mock.calls[0][1]).toBe(payLeg.mock.calls[0][1]);
    });

    it('matches a leg only on the persisted idempotency key, never on payer, amount and method', () => {
        const legs = {
            a: { key: 'k1', fingerprint: 'f', spec: { paymentMethodId: 1, amount: 115, payerName: 'Ana' } },
            b: { key: 'k2', fingerprint: 'f', spec: { paymentMethodId: 1, amount: 115, payerName: 'Beto' } },
            c: { key: 'k3', fingerprint: 'f', spec: { paymentMethodId: 2, amount: 10 } },
        };
        const payments = [
            { amount: '115.00', status: 'ACTIVE', paymentMethodId: 1, payerName: ' ana ' }, // looks like a, but carries no key
            { amount: '115.00', status: 'REVERSED', paymentMethodId: 1, payerName: 'Beto', idempotencyKey: 'k2' }, // reversed: not paid
            { amount: '10.00', status: 'ACTIVE', paymentMethodId: 2, payerName: null, idempotencyKey: 'k3' },
        ];
        expect(matchPaidLegs(legs, payments)).toEqual(['c']);
    });
});

describe('rounding in cents', () => {
    const sum = (xs: number[]) => xs.reduce((n, x) => n + Math.round(x * 100), 0);
    it('C$ 100.00 in 3 sums exactly and the last leg takes the remainder', () => {
        const parts = evenLegAmounts(100, 3);
        expect(parts).toEqual([33.33, 33.33, 33.34]);
        expect(sum(parts)).toBe(10000);
    });
    it('C$ 0.05 in 2 sums exactly', () => {
        const parts = evenLegAmounts(0.05, 2);
        expect(parts).toEqual([0.02, 0.03]);
        expect(sum(parts)).toBe(5);
    });
});
