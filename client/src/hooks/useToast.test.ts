import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Call the hook outside a renderer: useCallback just returns the callback.
vi.mock('react', () => ({ useCallback: <T>(fn: T) => fn }));

import { useToast } from './useToast';
import { __resetNoticesForTests, isErrorHandled, notifyError, subscribeNotices, type AppNotice } from '../services/notify';
import { handleUnhandledRejection } from '../services/globalErrorHandlers';

describe('useToast().error with cause', () => {
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

    it('marks the cause handled so show-then-rethrow toasts only once', () => {
        const err = { isAxiosError: true, config: {}, response: { status: 500, data: { message: 'Error interno del servidor' } } };
        useToast().error('No se pudo guardar la orden', err);
        expect(isErrorHandled(err)).toBe(true);

        notifyError(err);
        handleUnhandledRejection({ reason: err });
        expect(received.map((n) => n.message)).toEqual(['No se pudo guardar la orden']);
    });

    it('stays backwards compatible without a cause', () => {
        useToast().error('Algo falló');
        useToast().showToast('Guardado', 'success');
        expect(received.map((n) => n.type)).toEqual(['error', 'success']);
    });
});
