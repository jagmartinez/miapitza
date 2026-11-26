import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CHUNK_LOAD_MESSAGE,
    GENERIC_ERROR_MESSAGE,
    NETWORK_MESSAGE,
    OFFLINE_MESSAGE,
    STATUS_MESSAGES,
    TIMEOUT_MESSAGE,
    describeApiError,
    getApiErrorMessage,
    withContext,
} from './apiError';

const axiosError = (status: number, data?: unknown, headers: Record<string, unknown> = {}) => ({
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config: { url: '/x', method: 'post' },
    response: { status, data, headers },
});

describe('describeApiError', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('prefers the server Spanish message', () => {
        const d = describeApiError(axiosError(409, { success: false, message: 'La mesa ya tiene una orden abierta', code: 'TABLE_BUSY' }));
        expect(d).toMatchObject({ kind: 'conflict', status: 409, code: 'TABLE_BUSY', message: 'La mesa ya tiene una orden abierta' });
    });

    it('reads `error` fields and nested error objects', () => {
        expect(getApiErrorMessage(axiosError(400, { error: 'Código de barras duplicado' }))).toBe('Código de barras duplicado');
        expect(getApiErrorMessage(axiosError(400, { error: { message: 'RTN inválido', code: 'BAD_RTN' } }))).toBe('RTN inválido');
    });

    it('appends validation details from `errors` and `details`', () => {
        const d = describeApiError(axiosError(400, {
            message: 'Error de validación',
            errors: [{ field: 'body.name', message: 'es requerido' }, { field: 'body.price', message: 'debe ser positivo' }],
        }));
        expect(d.kind).toBe('validation');
        expect(d.details).toEqual(['name: es requerido', 'price: debe ser positivo']);
        expect(d.message).toBe(`${STATUS_MESSAGES[400]} (name: es requerido; price: debe ser positivo)`);

        const zodLike = describeApiError(axiosError(422, { message: 'Datos inválidos', details: { email: ['Correo inválido'] } }));
        expect(zodLike.message).toBe('Datos inválidos (email: Correo inválido)');
    });

    it.each([
        [401, STATUS_MESSAGES[401], 'auth'],
        [403, STATUS_MESSAGES[403], 'forbidden'],
        [404, STATUS_MESSAGES[404], 'notFound'],
        [409, STATUS_MESSAGES[409], 'conflict'],
        [413, STATUS_MESSAGES[413], 'payloadTooLarge'],
        [422, STATUS_MESSAGES[422], 'validation'],
        [428, STATUS_MESSAGES[428], 'precondition'],
        [500, STATUS_MESSAGES[500], 'server'],
        [503, STATUS_MESSAGES[503], 'unavailable'],
    ])('gives a clear default for %d', (status, message, kind) => {
        const d = describeApiError(axiosError(status, {}));
        expect(d.message).toBe(message);
        expect(d.kind).toBe(kind);
    });

    it('replaces generic server placeholders with the actionable status text', () => {
        expect(getApiErrorMessage(axiosError(500, { success: false, message: 'Error interno del servidor' }))).toBe(STATUS_MESSAGES[500]);
        expect(getApiErrorMessage(axiosError(400, { message: 'Ocurrió un error' }))).toBe(STATUS_MESSAGES[400]);
    });

    it('never shows HTML pages or technical texts', () => {
        expect(getApiErrorMessage(axiosError(502, '<html><body>Bad gateway</body></html>'))).toBe(STATUS_MESSAGES[502]);
        expect(getApiErrorMessage(axiosError(500, { message: "Cannot read properties of undefined (reading 'id')" }))).toBe(STATUS_MESSAGES[500]);
    });

    it('translates legacy English server messages', () => {
        expect(getApiErrorMessage(axiosError(403, { message: 'Insufficient permissions' }))).toBe(STATUS_MESSAGES[403]);
    });

    it('adds Retry-After to 429', () => {
        const d = describeApiError(axiosError(429, { message: 'Too many requests, please try again later' }, { 'retry-after': '30' }));
        expect(d.kind).toBe('rateLimit');
        expect(d.message).toBe(`${STATUS_MESSAGES[429]} Podrás reintentar en 30 s.`);
    });

    it('distinguishes timeout, offline and network failures', () => {
        expect(describeApiError({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded', config: {} }))
            .toMatchObject({ kind: 'timeout', message: TIMEOUT_MESSAGE });
        expect(describeApiError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error', config: {} }))
            .toMatchObject({ kind: 'network', message: NETWORK_MESSAGE });
        vi.stubGlobal('navigator', { onLine: false });
        expect(describeApiError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error', config: {} }))
            .toMatchObject({ kind: 'offline', message: OFFLINE_MESSAGE });
    });

    it('flags canceled requests', () => {
        expect(describeApiError({ name: 'CanceledError', code: 'ERR_CANCELED', message: 'canceled' }).kind).toBe('canceled');
    });

    it('keeps human messages from app code but hides runtime bugs', () => {
        expect(getApiErrorMessage(new Error('Seleccione una sucursal'))).toBe('Seleccione una sucursal');
        expect(getApiErrorMessage(new TypeError('x.map is not a function'))).toBe(GENERIC_ERROR_MESSAGE);
        expect(getApiErrorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    });

    it('recognises lazy chunk load failures', () => {
        expect(describeApiError(new TypeError('Failed to fetch dynamically imported module: /assets/POS.js')))
            .toMatchObject({ kind: 'chunkLoad', message: CHUNK_LOAD_MESSAGE });
    });

    it('prefixes context once', () => {
        expect(getApiErrorMessage(axiosError(404, {}), 'No se pudo guardar el producto')).toBe(`No se pudo guardar el producto: ${STATUS_MESSAGES[404]}`);
        expect(withContext('No se pudo guardar.', 'No se pudo guardar.')).toBe('No se pudo guardar.');
        expect(withContext(undefined, 'x')).toBe('x');
    });
});
