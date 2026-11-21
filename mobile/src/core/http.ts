import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { appEvents } from './events';
import type { Session, SessionStore } from './session';

/** A 401 from these means "bad credentials", not "your session ended". */
const CREDENTIAL_PATHS = new Set(['/auth/login', '/auth/pin-login', '/auth/device-login']);

/**
 * Supervisor discount endpoints. They also read X-Device-Token, and a 401 from them
 * means a wrong supervisor PIN or a bad device token, never that the waiter's session ended.
 */
const DISCOUNT_AUTH_PATTERNS: readonly RegExp[] = [
    /^\/orders\/discount\/supervisors$/,
    /^\/orders\/\d+\/discount\/authorize$/,
];
const isDiscountAuthPath = (path: string) => DISCOUNT_AUTH_PATTERNS.some((re) => re.test(path));

/** The only endpoints that read X-Device-Token (plus DISCOUNT_AUTH_PATTERNS); it is not sent anywhere else. */
const DEVICE_TOKEN_PATHS = new Set(['/auth/device-roster', '/auth/pin-login', '/auth/device-login']);

/** A hung request must fail instead of leaving the UI waiting forever. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Token a request was actually sent with, recorded on its config. */
type TrackedConfig = InternalAxiosRequestConfig & { _sentToken?: string };

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

export function createHttp(opts: { baseURL: string; sessions: SessionStore }): AxiosInstance {
    const http = axios.create({ baseURL: opts.baseURL, timeout: DEFAULT_TIMEOUT_MS });
    const baseIsAbsolute = ABSOLUTE.test(opts.baseURL);
    const baseOrigin = baseIsAbsolute ? new URL(opts.baseURL).origin : null;
    const basePath = baseIsAbsolute ? new URL(opts.baseURL).pathname.replace(/\/+$/, '') : opts.baseURL.replace(/\/+$/, '');

    /** Credentials only ever go to the API origin, never to an absolute URL elsewhere. */
    function isApiRequest(config: InternalAxiosRequestConfig): boolean {
        const resolved = http.getUri(config);
        if (!ABSOLUTE.test(resolved)) return true;
        if (!baseOrigin) return false;
        try {
            return new URL(resolved).origin === baseOrigin;
        } catch {
            return false;
        }
    }

    /** Request path relative to the API base, without a trailing slash; null if unparseable. */
    function apiPath(config: InternalAxiosRequestConfig | undefined): string | null {
        if (!config) return null;
        let path: string;
        try {
            path = new URL(http.getUri(config), 'http://local.invalid').pathname;
        } catch {
            return null;
        }
        path = path.replace(/\/+$/, '');
        if (basePath && path.startsWith(basePath + '/')) path = path.slice(basePath.length);
        return path;
    }

    function isCredentialRequest(config: InternalAxiosRequestConfig | undefined): boolean {
        const path = apiPath(config);
        return path !== null && (CREDENTIAL_PATHS.has(path) || isDiscountAuthPath(path));
    }

    http.interceptors.request.use(async (config) => {
        if (!isApiRequest(config)) return config;
        const path = apiPath(config) ?? '';
        const sendsDeviceToken = DEVICE_TOKEN_PATHS.has(path) || isDiscountAuthPath(path);
        const [session, deviceToken] = await Promise.all([
            opts.sessions.load(),
            sendsDeviceToken ? opts.sessions.deviceToken() : Promise.resolve(null),
        ]);
        // An explicit Authorization (admin setup, background revoke) is never overridden.
        if (session?.token && !config.headers.has('Authorization')) {
            config.headers.set('Authorization', `Bearer ${session.token}`);
            (config as TrackedConfig)._sentToken = session.token;
        }
        if (deviceToken) config.headers.set('X-Device-Token', deviceToken);
        return config;
    });

    // One in-flight expiry per token: a burst of 401s clears and emits once.
    let expiring: { token: string; done: Promise<void> } | null = null;

    async function expire(sentToken: string): Promise<void> {
        if (expiring?.token === sentToken) return expiring.done;
        const current = await opts.sessions.load();
        // A newer session (PIN switch, re-login) must survive a late 401 from an old request.
        if (!current || current.token !== sentToken) return;
        if (expiring?.token === sentToken) return expiring.done;
        const done = (async () => {
            // Only the session goes; the device token and any local data stay.
            try {
                await opts.sessions.clear();
            } finally {
                // The UI must lock even if storage misbehaves.
                appEvents.emit('session-expired');
            }
        })().finally(() => {
            if (expiring?.done === done) expiring = null;
        });
        expiring = { token: sentToken, done };
        return done;
    }

    http.interceptors.response.use(
        (response) => response,
        async (error) => {
            const config = error?.config as TrackedConfig | undefined;
            const sent = config?._sentToken;
            if (error?.response?.status === 401 && sent && !isCredentialRequest(config)) {
                try {
                    await expire(sent);
                } catch {
                    // Surface the original 401, not a storage error.
                }
            }
            // Password gate: surface it, never clear the session (change-password still needs it).
            if (error?.response?.status === 403 && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED' && sent) {
                // A late 403 from a previous user's token must not block the next user.
                let current: Session | null = null;
                try {
                    current = await opts.sessions.load();
                } catch {
                    // Unreadable storage: treat as no current session.
                }
                if (current?.token === sent) appEvents.emit('password-change-required');
            }
            return Promise.reject(error);
        },
    );

    return http;
}
