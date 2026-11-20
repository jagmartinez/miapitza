import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { appEvents } from './events';
import type { SessionStore } from './session';

/** A 401 from these means "bad credentials", not "your session ended". */
const CREDENTIAL_PATHS = new Set(['/auth/login', '/auth/pin-login', '/auth/device-login']);

/** Token a request was actually sent with, recorded on its config. */
type TrackedConfig = InternalAxiosRequestConfig & { _sentToken?: string };

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

export function createHttp(opts: { baseURL: string; sessions: SessionStore }): AxiosInstance {
    const http = axios.create({ baseURL: opts.baseURL });
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

    function isCredentialRequest(config: InternalAxiosRequestConfig | undefined): boolean {
        if (!config) return false;
        let path: string;
        try {
            path = new URL(http.getUri(config), 'http://local.invalid').pathname;
        } catch {
            return false;
        }
        path = path.replace(/\/+$/, '');
        if (basePath && path.startsWith(basePath + '/')) path = path.slice(basePath.length);
        return CREDENTIAL_PATHS.has(path);
    }

    http.interceptors.request.use(async (config) => {
        if (!isApiRequest(config)) return config;
        const [session, deviceToken] = await Promise.all([opts.sessions.load(), opts.sessions.deviceToken()]);
        if (session?.token) {
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
            await opts.sessions.clear();
            appEvents.emit('session-expired');
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
                await expire(sent);
            }
            return Promise.reject(error);
        },
    );

    return http;
}
