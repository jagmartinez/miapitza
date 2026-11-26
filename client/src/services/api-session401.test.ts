import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));
vi.mock('./offlineManager', () => ({
    offlineManager: {
        enqueueRequest: vi.fn(),
        isOnline: vi.fn(() => true),
    },
}));

import { isSessionEnding401 } from './api';

describe('401 interceptor session guard', () => {
    it('ends the session for plain or session-coded 401s', () => {
        expect(isSessionEnding401({ response: { status: 401, data: { message: 'Token inválido o expirado' } } })).toBe(true);
        expect(isSessionEnding401({ response: { status: 401, data: { code: 'SESSION_EXPIRED' } } })).toBe(true);
        expect(isSessionEnding401({ response: { status: 401 } })).toBe(true);
    });

    it.each(['CHALLENGE_INVALID', 'CHALLENGE_TOKEN_INVALID', 'DEVICE_INVALID', 'DEVICE_CREDENTIALS_REQUIRED'])(
        'keeps the session for biometric/device 401 %s',
        (code) => {
            expect(isSessionEnding401({ response: { status: 401, data: { code } } })).toBe(false);
        },
    );

    it('ignores non-401 responses', () => {
        expect(isSessionEnding401({ response: { status: 403, data: { code: 'DEVICE_INVALID' } } })).toBe(false);
        expect(isSessionEnding401(new Error('Network Error'))).toBe(false);
    });
});
