import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const listeners: { event: string; cb: () => void; remove: ReturnType<typeof vi.fn> }[] = [];
vi.mock('@capacitor/app', () => ({
    App: {
        addListener: vi.fn(async (event: string, cb: () => void) => {
            const remove = vi.fn(async () => undefined);
            listeners.push({ event, cb, remove });
            return { remove };
        }),
    },
}));
vi.mock('@capacitor/core', async (orig) => {
    const actual = await orig<typeof import('@capacitor/core')>();
    return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } };
});

import SurveyScreen, { cleanPhone } from './SurveyScreen';
import { SurveyBoundary } from './SurveyBoundary';
import { createSurveyApi, surveyKey, FIRST_ATTEMPT_TIMEOUT_MS } from './surveyApi';
import { itemTitle, SURVEY_URL, isSurveyItem } from '../../data/queueLabels';
import type { SyncItem } from '../../data/types';

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

function setup(over: Partial<{ submit: (i: unknown, k: string) => Promise<unknown>; waiterName: string }> = {}) {
    const submit = vi.fn(over.submit ?? (async () => ({ created: true })));
    const onDone = vi.fn();
    render(<SurveyScreen orderId={102} waiterName={over.waiterName ?? 'Ana Perez'} submit={submit} onDone={onDone} />);
    return { submit, onDone };
}
const nps = (n: number) => fireEvent.click(screen.getByRole('button', { name: String(n) }));
const stars = (label: string, n: number) => fireEvent.click(screen.getByRole('button', { name: `${label}: ${n} de 5` }));

beforeEach(() => {
    listeners.length = 0;
    vi.useFakeTimers();
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('SurveyScreen', () => {
    it('shows the NPS question with legend and the rest after choosing', () => {
        setup();
        expect(screen.getByText('¿Qué tan probable es que nos recomiendes a un amigo?')).toBeInTheDocument();
        expect(screen.getByText('Nada probable')).toBeInTheDocument();
        expect(screen.getByText('Muy probable')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
        nps(9);
        expect(screen.getByText('Atención de Ana')).toBeInTheDocument();
        expect(screen.getByText('Comida')).toBeInTheDocument();
        expect(screen.getByText('Tiempo de espera')).toBeInTheDocument();
        expect(screen.getByText('Ambiente y limpieza')).toBeInTheDocument();
        expect(screen.getByText('Comentario (opcional)')).toBeInTheDocument();
        expect(screen.getByText('Teléfono (opcional, si quieres que te contactemos)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    });

    it('submits answers with stable idempotency key per order', async () => {
        const { submit } = setup();
        nps(10);
        stars('Atención de Ana', 5);
        stars('Comida', 4);
        stars('Tiempo de espera', 3);
        stars('Ambiente y limpieza', 2);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith({ orderId: 102, nps: 10, waiterRating: 5, foodRating: 4, waitRating: 3, ambienceRating: 2, comment: null, contactPhone: null }, surveyKey(102));
        expect(surveyKey(102)).toBe(surveyKey(102));
        expect(surveyKey(103)).not.toBe(surveyKey(102));
        expect(screen.getByText('¡Gracias por tu opinión!')).toBeInTheDocument();
    });

    it('phone and comment trimmed; empty sent as null', async () => {
        const { submit } = setup();
        nps(7);
        fireEvent.change(screen.getByLabelText('Comentario (opcional)'), { target: { value: '  Todo bien  ' } });
        fireEvent.change(screen.getByLabelText('Teléfono (opcional, si quieres que te contactemos)'), { target: { value: '  8888-1234 ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(submit.mock.calls[0][0]).toMatchObject({ comment: 'Todo bien', contactPhone: '8888-1234', waiterRating: null, foodRating: null });
    });

    it('blank comment and phone go as null', async () => {
        const { submit } = setup();
        nps(0);
        fireEvent.change(screen.getByLabelText('Comentario (opcional)'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(submit.mock.calls[0][0]).toMatchObject({ nps: 0, comment: null, contactPhone: null });
    });

    it('double tap Enviar submits once', async () => {
        const { submit } = setup({ submit: () => new Promise(() => undefined) });
        nps(8);
        const send = screen.getByRole('button', { name: 'Enviar' });
        fireEvent.click(send);
        fireEvent.click(send);
        await flush();
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('thanks then onDone after 5s', async () => {
        const { onDone } = setup();
        nps(9);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(onDone).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4900);
        });
        expect(onDone).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('a failing submit (domain error) still thanks and locks', async () => {
        const { onDone } = setup({ submit: async () => Promise.reject(Object.assign(new Error('x'), { response: { status: 409 } })) });
        nps(9);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(screen.getByText('¡Gracias por tu opinión!')).toBeInTheDocument();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5100);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('waits for a slow submit before locking, but not forever', async () => {
        let release: () => void = () => undefined;
        const { onDone } = setup({ submit: () => new Promise((r) => (release = () => r({}))) });
        nps(9);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5100);
        });
        expect(onDone).not.toHaveBeenCalled();
        await act(async () => {
            release();
            await vi.advanceTimersByTimeAsync(10);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('locks anyway when the submit never settles', async () => {
        const { onDone } = setup({ submit: () => new Promise(() => undefined) });
        nps(9);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('idle 60s with nps submits partial then locks', async () => {
        const order: string[] = [];
        const { submit, onDone } = setup({ submit: async () => void order.push('submit') });
        onDone.mockImplementation(() => order.push('lock'));
        nps(6);
        stars('Comida', 4);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_100);
        });
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0]).toMatchObject({ nps: 6, foodRating: 4, waiterRating: null });
        expect(order).toEqual(['submit', 'lock']);
    });

    it('idle without nps locks without submit', async () => {
        const { submit, onDone } = setup();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_100);
        });
        expect(submit).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('touch restarts the idle countdown', async () => {
        const { onDone } = setup();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50_000);
        });
        fireEvent.pointerDown(document);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50_000);
        });
        expect(onDone).not.toHaveBeenCalled();
    });

    it('back button is swallowed while survey open', async () => {
        const { unmount } = render(<SurveyScreen orderId={1} waiterName="Ana" submit={vi.fn()} onDone={vi.fn()} />);
        await flush();
        const l = listeners.find((x) => x.event === 'backButton');
        expect(l).toBeTruthy();
        expect(() => l!.cb()).not.toThrow();
        unmount();
        await flush();
        expect(l!.remove).toHaveBeenCalled();
    });
});

describe('surveyApi', () => {
    const body = { orderId: 5, nps: 9, waiterRating: null, foodRating: null, waitRating: null, ambienceRating: null, comment: null, contactPhone: null };

    it('posts to /surveys with the key and GENERIC_MUTATION queue', async () => {
        const mutate = vi.fn().mockResolvedValue({ created: true });
        await createSurveyApi({ mutate }).submit(body, 'survey-5');
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate.mock.calls[0][0]).toMatchObject({ method: 'POST', url: SURVEY_URL, data: body, key: 'survey-5', queue: { operationType: 'GENERIC_MUTATION', meta: { label: 'Encuesta del cliente' } } });
    });

    it('queues once with the same key after a network failure', async () => {
        const net = Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, code: 'ERR_NETWORK' });
        const mutate = vi.fn().mockRejectedValueOnce(net).mockResolvedValueOnce({ _offline: true });
        await createSurveyApi({ mutate }).submit(body, 'survey-5');
        expect(mutate).toHaveBeenCalledTimes(2);
        expect(mutate.mock.calls[1][0]).toMatchObject({ key: 'survey-5', queue: { operationType: 'GENERIC_MUTATION', forceQueue: true } });
    });

    it('does not queue a domain 4xx', async () => {
        const err = Object.assign(new Error('conflict'), { isAxiosError: true, response: { status: 403, data: { code: 'SURVEY_DEVICE_REQUIRED' } } });
        const mutate = vi.fn().mockRejectedValue(err);
        await expect(createSurveyApi({ mutate }).submit(body, 'survey-5')).rejects.toBe(err);
        expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('queued survey is labelled Encuesta del cliente', () => {
        expect(itemTitle({ operationType: 'GENERIC_MUTATION', meta: { label: 'Encuesta del cliente' } } as unknown as SyncItem)).toBe('Encuesta del cliente');
        expect(itemTitle({ operationType: 'GENERIC_MUTATION', url: '/v1/surveys', method: 'POST' } as unknown as SyncItem)).toBe('Encuesta del cliente');
    });
});

describe('fix round 1', () => {
    const body = { orderId: 5, nps: 9, waiterRating: 4, foodRating: null, waitRating: null, ambienceRating: null, comment: 'ok', contactPhone: '8888-1234' };
    const http = (status: number, code: string) => Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { code } } });

    it('first attempt times out before the lock bound, and the enqueue happens while the session exists', async () => {
        let session = true;
        const queuedWhile: boolean[] = [];
        const mutate = vi.fn(async (spec: { config?: { timeout?: number }; queue?: { forceQueue?: boolean } }) => {
            if (spec.queue?.forceQueue) {
                queuedWhile.push(session);
                if (!session) throw new Error('No hay sesión para encolar la operación');
                return { _offline: true };
            }
            // a dead network: the request only fails when its own timeout elapses
            await new Promise((r) => setTimeout(r, spec.config?.timeout ?? 15_000));
            throw Object.assign(new Error('timeout of 5000ms exceeded'), { isAxiosError: true, request: {}, code: 'ECONNABORTED' });
        });
        const api = createSurveyApi({ mutate });
        const onDone = vi.fn(() => {
            session = false;
        });
        render(<SurveyScreen orderId={9} waiterName="Ana" submit={api.submit} onDone={onDone} />);
        nps(9);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(FIRST_ATTEMPT_TIMEOUT_MS).toBeLessThan(8_000);
        expect(queuedWhile).toEqual([true]);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('cleanPhone keeps only accepted characters and needs 6', () => {
        expect(cleanPhone(' 8888-1234 ')).toBe('8888-1234');
        expect(cleanPhone('+505 (8888) 1234')).toBe('+505 (8888) 1234');
        expect(cleanPhone('8888.1234 #')).toBe('88881234');
        expect(cleanPhone('ext 123')).toBeNull();
        expect(cleanPhone('abc')).toBeNull();
        expect(cleanPhone('1'.repeat(40))).toHaveLength(30);
    });

    it('sanitised phone goes to the server; a short one goes as null', async () => {
        const { submit } = setup();
        nps(8);
        fireEvent.change(screen.getByLabelText('Teléfono (opcional, si quieres que te contactemos)'), { target: { value: '12-ab' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(submit.mock.calls[0][0]).toMatchObject({ contactPhone: null });
    });

    it('SURVEY_INVALID 400 retries once without comment and phone', async () => {
        const mutate = vi.fn().mockRejectedValueOnce(http(400, 'SURVEY_INVALID')).mockResolvedValueOnce({ created: true });
        await createSurveyApi({ mutate }).submit(body, 'survey-5');
        expect(mutate).toHaveBeenCalledTimes(2);
        expect(mutate.mock.calls[1][0].data).toEqual({ ...body, comment: null, contactPhone: null });
        expect(mutate.mock.calls[1][0].key).not.toBe('survey-5');
    });

    it('SURVEY_INVALID without free text is not retried', async () => {
        const mutate = vi.fn().mockRejectedValue(http(400, 'SURVEY_INVALID'));
        await expect(createSurveyApi({ mutate }).submit({ ...body, comment: null, contactPhone: null }, 'k')).rejects.toBeTruthy();
        expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('409 by code: NOT_PAID is definitive, IDEMPOTENCY_IN_PROGRESS is accepted without queueing', async () => {
        const notPaid = vi.fn().mockRejectedValue(http(409, 'SURVEY_ORDER_NOT_PAID'));
        await expect(createSurveyApi({ mutate: notPaid }).submit(body, 'k')).rejects.toBeTruthy();
        expect(notPaid).toHaveBeenCalledTimes(1);
        const busy = vi.fn().mockRejectedValue(http(409, 'IDEMPOTENCY_IN_PROGRESS'));
        await expect(createSurveyApi({ mutate: busy }).submit(body, 'k')).resolves.toBeUndefined();
        expect(busy).toHaveBeenCalledTimes(1);
    });

    it('tapping the selected star keeps it', async () => {
        const { submit } = setup();
        nps(5);
        stars('Comida', 4);
        stars('Comida', 4);
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await flush();
        expect(submit.mock.calls[0][0]).toMatchObject({ foodRating: 4 });
    });

    it('the details step ignores taps right after an NPS key (double tap tail)', () => {
        setup();
        nps(9);
        expect(screen.getByTestId('survey')).toHaveClass('sv-settling');
    });

    it('a crashing survey falls back to locking', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onFail = vi.fn();
        const Boom = () => {
            throw new Error('chunk');
        };
        render(
            <SurveyBoundary onFail={onFail}>
                <Boom />
            </SurveyBoundary>,
        );
        expect(onFail).toHaveBeenCalledTimes(1);
        err.mockRestore();
    });
});

describe('fix wave', () => {
    const http = (status: number, code?: string) => Object.assign(new Error('x'), { isAxiosError: true, response: { status, data: code ? { code } : {} } });
    const body = { orderId: 5, nps: 9, waiterRating: null, foodRating: null, waitRating: null, ambienceRating: null, comment: null, contactPhone: null };

    it('the survey path is the v1 route the server mounts', () => {
        expect(SURVEY_URL).toBe('/v1/surveys');
    });

    it('goes through the real waiter api to /v1/surveys', async () => {
        const { createWaiterApi } = await import('../../data/waiterApi');
        const request = vi.fn().mockResolvedValue({ data: { data: { created: true } } });
        const api = createWaiterApi({
            http: { request } as never,
            sessions: { load: async () => ({ token: 't', user: { id: 1, companyId: 1 } }) } as never,
            cache: { invalidate: async () => undefined } as never,
            queue: { onSynced: () => undefined } as never,
            isOnline: () => true,
        });
        await createSurveyApi(api).submit(body, 'survey-order-5');
        expect(request.mock.calls[0][0]).toMatchObject({ method: 'POST', url: '/v1/surveys', data: body });
        expect(request.mock.calls[0][0].headers['X-Idempotency-Key']).toBe('survey-order-5');
    });

    it('a 404 without a SURVEY code (missing route) is queued, not dropped', async () => {
        const mutate = vi.fn().mockRejectedValueOnce(http(404)).mockResolvedValueOnce({ _offline: true });
        await createSurveyApi({ mutate }).submit(body, 'k');
        expect(mutate.mock.calls[1][0].queue.forceQueue).toBe(true);
    });

    it('SURVEY_ORDER_NOT_FOUND 404 and IDEMPOTENCY_MISMATCH 409 are definitive', async () => {
        for (const e of [http(404, 'SURVEY_ORDER_NOT_FOUND'), http(409, 'IDEMPOTENCY_MISMATCH')]) {
            const mutate = vi.fn().mockRejectedValue(e);
            await expect(createSurveyApi({ mutate }).submit(body, 'k')).rejects.toBe(e);
            expect(mutate).toHaveBeenCalledTimes(1);
        }
    });

    it('survey items are recognised by url', () => {
        expect(isSurveyItem({ url: '/v1/surveys' })).toBe(true);
        expect(isSurveyItem({ url: '/orders/1' })).toBe(false);
    });
});
