import type { AxiosInstance } from 'axios';
import type { createRealtime } from './realtime';
import type { SessionStore } from './session';

const REVOKE_TIMEOUT_MS = 5_000;

/**
 * Ends the local session first, then tells the server in the background.
 * Locking never waits on the network: the token is captured, realtime is closed
 * (before the revoke, so a server-pushed 4001 cannot hit the next user), the stored
 * session is dropped, and only then is POST /auth/logout fired, best effort.
 */
export async function lockAndRevoke(deps: {
    http: AxiosInstance;
    sessions: SessionStore;
    realtime: Pick<ReturnType<typeof createRealtime>, 'close'>;
}): Promise<void> {
    const { http, sessions, realtime } = deps;
    realtime.close();
    const token = (await sessions.load())?.token;
    const cleared = sessions.clear(); // memory copy is gone synchronously
    if (token) {
        void http
            .post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${token}` }, timeout: REVOKE_TIMEOUT_MS })
            .catch(() => undefined);
    }
    await cleared;
}
