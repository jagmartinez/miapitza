import type { AxiosInstance } from 'axios';
import { appEvents } from './events';
import { httpCode, httpStatus } from './httpErrors';
import type { createRealtime } from './realtime';
import type { Session, SessionStore } from './session';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const UNAVAILABLE_RETRY_MS = 60_000;
/** Minimum spacing between device-login attempts triggered by session-expired storms. */
const MIN_RELOGIN_GAP_MS = 2000;

export type KitchenAuthStatus = 'connecting' | 'online' | 'renewing' | 'account-unavailable' | 'offline';

let lastStatus: KitchenAuthStatus = 'connecting';
/** Latest status, for screens that mount after it was emitted. */
export const kitchenAuthStatus = () => lastStatus;
function setStatus(status: KitchenAuthStatus) {
    lastStatus = status;
    appEvents.emit('kitchen-auth-status', status);
}

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
    // Re-login spacing when the socket never became healthy after the last login.
    let expiryBackoff = MIN_BACKOFF_MS;
    let online = false;
    let lastAttemptAt = -Infinity;
    let unsubscribeStatus: (() => void) | null = null;
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
        setStatus('connecting');
        await sessions.clearDevice();
        await sessions.clear();
        onRevoked();
    }

    async function attempt() {
        if (stopped || inFlight) return;
        inFlight = true;
        lastAttemptAt = Date.now();
        try {
            if (!(await sessions.deviceToken())) {
                await revoke();
                return;
            }
            const res = await http.post('/auth/device-login');
            const { token, user } = res.data.data;
            if (stopped) return;
            const branch = res.data.data.branch?.name;
            if (typeof branch === 'string' && branch.trim()) await sessions.saveBranchName(branch.trim());
            const session: Session = { token, user, issuedAt: Date.now() };
            // Save first, then (re)connect: the socket AUTH reads the stored token.
            await sessions.save(session);
            await realtime.reconnect();
            backoff = MIN_BACKOFF_MS;
            online = false;
            if (lastStatus === 'account-unavailable' || lastStatus === 'offline') setStatus('online');
            onSession(session);
        } catch (err) {
            if (stopped) return;
            const status = httpStatus(err);
            const code = httpCode(err);
            // Only an explicit "this device is no longer authorized" unpairs; any other 401 may be transient.
            if (status === 401 && code === 'DEVICE_NOT_ACTIVE') {
                await revoke();
                return;
            }
            if (status === 403 && code === 'KITCHEN_ACCOUNT_UNAVAILABLE') {
                setStatus('account-unavailable');
                schedule(UNAVAILABLE_RETRY_MS);
                return;
            }
            if (lastStatus === 'account-unavailable') setStatus('offline');
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
            setStatus('connecting');
            unsubscribe?.();
            unsubscribeStatus?.();
            // CONNECTED proves the new session works: the next expiry is a normal one.
            unsubscribeStatus = appEvents.on('realtime-status', (status) => {
                if (status === 'online') {
                    online = true;
                    expiryBackoff = MIN_BACKOFF_MS;
                    setStatus('online');
                } else if (status === 'offline' && lastStatus === 'online') {
                    setStatus('offline');
                }
            });
            unsubscribe = appEvents.on('session-expired', () => {
                if (lastStatus !== 'account-unavailable') setStatus('renewing');
                if (online) {
                    schedule(Math.max(0, MIN_RELOGIN_GAP_MS - (Date.now() - lastAttemptAt)));
                    return;
                }
                // Socket auth failed right after a successful login: back off 1 s -> 30 s.
                const wait = expiryBackoff;
                expiryBackoff = Math.min(expiryBackoff * 2, MAX_BACKOFF_MS);
                schedule(wait);
            });
            await attempt();
        },
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            timer = null;
            setStatus('connecting');
            unsubscribe?.();
            unsubscribe = null;
            unsubscribeStatus?.();
            unsubscribeStatus = null;
        },
    };
}
