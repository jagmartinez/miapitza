import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetNoticesForTests,
    isErrorHandled,
    markErrorHandled,
    notifyError,
    publishNotice,
    subscribeNotices,
    type AppNotice,
} from './notify';
import { handleUnhandledRejection, handleWindowError } from './globalErrorHandlers';
import { addOrBumpToast } from '../context/toastQueue';

const axios500 = () => ({ isAxiosError: true, config: {}, response: { status: 500, data: { message: 'Error interno del servidor' } } });

describe('notification bus', () => {
    let received: AppNotice[];
    let unsubscribe: () => void;

    beforeEach(() => {
        __resetNoticesForTests();
        vi.stubGlobal('window', { location: { pathname: '/orders', href: 'http://localhost/orders', origin: 'http://localhost' } });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        received = [];
        unsubscribe = subscribeNotices((n) => received.push(n));
    });

    afterEach(() => {
        unsubscribe();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('buffers notices published before a renderer subscribes', () => {
        unsubscribe();
        publishNotice({ message: 'temprano', type: 'info' });
        const late: AppNotice[] = [];
        unsubscribe = subscribeNotices((n) => late.push(n));
        expect(late.map((n) => n.message)).toEqual(['temprano']);
    });

    it('notifyError toasts a Spanish message with context and returns the description', () => {
        const described = notifyError(axios500(), 'No se pudo cerrar la caja');
        expect(described.kind).toBe('server');
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ type: 'error' });
        expect(received[0].message).toMatch(/^No se pudo cerrar la caja: Error interno del servidor\. Intenta de nuevo/);
    });

    it('never toasts the same error object twice', () => {
        const err = axios500();
        notifyError(err);
        notifyError(err);
        handleUnhandledRejection({ reason: err });
        expect(received).toHaveLength(1);
        expect(isErrorHandled(err)).toBe(true);
    });

    it('skips canceled requests and 401s (the interceptor redirects to login)', () => {
        notifyError({ name: 'CanceledError', code: 'ERR_CANCELED' });
        notifyError({ isAxiosError: true, config: {}, response: { status: 401, data: {} } });
        expect(received).toHaveLength(0);
    });

    it('global handlers surface unhandled rejections and runtime errors, ignoring noise', () => {
        handleUnhandledRejection({ reason: { isAxiosError: true, config: {}, response: { status: 403, data: { message: 'No autorizado para esta sucursal' } } } });
        handleWindowError({ message: 'ResizeObserver loop limit exceeded' });
        handleWindowError({ message: 'Script error.', filename: '' });
        handleWindowError({ message: 'boom', filename: 'chrome-extension://abc/x.js', error: new Error('boom') });
        handleWindowError({ message: 'Uncaught TypeError', filename: 'http://localhost/assets/app.js', error: new TypeError('a is undefined') });
        expect(received.map((n) => n.message)).toEqual([
            'No autorizado para esta sucursal',
            expect.stringMatching(/^Ocurrió un error inesperado/),
        ]);
    });

    it('marked errors (e.g. caught by ErrorBoundary) are not re-toasted', () => {
        const err = new Error('Render roto');
        markErrorHandled(err);
        handleUnhandledRejection({ reason: err });
        expect(received).toHaveLength(0);
    });
});

describe('addOrBumpToast', () => {
    it('dedupes identical notices, bumps the count and caps the stack', () => {
        let state = addOrBumpToast([], { message: 'A', type: 'error' });
        state = addOrBumpToast(state, { message: 'A', type: 'error' });
        expect(state).toHaveLength(1);
        expect(state[0].count).toBe(2);
        for (const m of ['B', 'C', 'D', 'E']) state = addOrBumpToast(state, { message: m, type: 'info' }, 4);
        // The oldest info goes first; the older error survives.
        expect(state.map((t) => t.message)).toEqual(['A', 'C', 'D', 'E']);
    });

    it('evicts success/info before warnings and errors last', () => {
        let state = addOrBumpToast([], { message: 'E1', type: 'error' }, 4);
        state = addOrBumpToast(state, { message: 'W1', type: 'warning' }, 4);
        state = addOrBumpToast(state, { message: 'S1', type: 'success' }, 4);
        state = addOrBumpToast(state, { message: 'E2', type: 'error' }, 4);
        state = addOrBumpToast(state, { message: 'E3', type: 'error' }, 4);
        expect(state.map((t) => t.message)).toEqual(['E1', 'W1', 'E2', 'E3']);
        state = addOrBumpToast(state, { message: 'E4', type: 'error' }, 4);
        expect(state.map((t) => t.message)).toEqual(['E1', 'E2', 'E3', 'E4']);
        state = addOrBumpToast(state, { message: 'E5', type: 'error' }, 4);
        expect(state.map((t) => t.message)).toEqual(['E2', 'E3', 'E4', 'E5']);
    });

    it('replaces a notice that shares a dedupe key', () => {
        let state = addOrBumpToast([], { message: 'Sin conexión', type: 'warning', dedupeKey: 'connectivity' });
        const firstId = state[0].id;
        state = addOrBumpToast(state, { message: 'Conexión restablecida.', type: 'success', dedupeKey: 'connectivity' });
        expect(state).toHaveLength(1);
        expect(state[0]).toMatchObject({ message: 'Conexión restablecida.', type: 'success', count: 1 });
        expect(state[0].id).not.toBe(firstId);
    });
});
