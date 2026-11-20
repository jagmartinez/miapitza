import type { AxiosInstance } from 'axios';
import { appEvents } from './events';
import { httpStatus } from './httpErrors';
import type { createRealtime } from './realtime';
import type { Session, SessionStore } from './session';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
/** A fresh session that expires again at once (e.g. socket auth loop) must not hammer the server. */
const MIN_RELOGIN_GAP_MS = 5000;

type RealtimeControl = Pick<ReturnType<typeof createRealtime>, 'reconnect'>;

interface Deps {
    http: AxiosInstance;
    sessions: SessionStore;
    realtime: RealtimeControl;
    /** The device token itself was rejected: the tablet was revoked. */
    onRevoked: () => void;
    onSession: (session: Session) => void;
}

/**
 * The kitchen tablet has no user to type a PIN: it exchanges its device token for a session
 * at startup and silently again whenever that session expires. mustChangePassword /
 * passwordExpired in the response are deliberately ignored (the kiosk account is fixed).
 */
export function createKitchenAuth(deps: Deps) {
    const { http, sessions, realtime, onRevoked, onSession } = deps;
    let stopped = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = MIN_BACKOFF_MS;
    let lastSuccessAt = 0;
    let unsubscribe: (() => void) | null = null;

    function schedule(delay: number) {
        if (stopped || timer) return; // one pending attempt at most: bursts of expiries coalesce
        timer = setTimeout(() => {
            timer = null;
            void attempt();
        }, delay);
    }

    async function revoke() {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
        await sessions.clearDevice();
        await sessions.clear();
        onRevoked();
    }

    async function attempt() {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
            if (!(await sessions.deviceToken())) {
                await revoke();
                return;
            }
            const res = await http.post('/auth/device-login');
            const { token, user } = res.data.data;
            if (stopped) return;
            const session: Session = { token, user, issuedAt: Date.now() };
            // Save first, then (re)connect: the socket AUTH reads the stored token.
            await sessions.save(session);
            await realtime.reconnect();
            backoff = MIN_BACKOFF_MS;
            lastSuccessAt = Date.now();
            onSession(session);
        } catch (err) {
            if (stopped) return;
            if (httpStatus(err) === 401) {
                await revoke();
                return;
            }
            const wait = backoff;
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            schedule(wait);
        } finally {
            inFlight = false;
        }
    }

    return {
        async start() {
            stopped = false;
            unsubscribe?.();
            unsubscribe = appEvents.on('session-expired', () => {
                schedule(Math.max(0, lastSuccessAt + MIN_RELOGIN_GAP_MS - Date.now()));
            });
            await attempt();
        },
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribe?.();
            unsubscribe = null;
        },
    };
}
