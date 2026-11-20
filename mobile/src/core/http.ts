import axios, { type AxiosInstance } from 'axios';
import { appEvents } from './events';
import type { SessionStore } from './session';

/** A 401 from these means "bad credentials", not "your session ended". */
const CREDENTIAL_PATHS = ['/auth/login', '/auth/pin-login', '/auth/device-login'];

function isCredentialRequest(url: string | undefined): boolean {
    if (!url) return false;
    const path = url.split('?')[0];
    return CREDENTIAL_PATHS.some((p) => path.endsWith(p));
}

export function createHttp(opts: { baseURL: string; sessions: SessionStore }): AxiosInstance {
    const http = axios.create({ baseURL: opts.baseURL });

    http.interceptors.request.use(async (config) => {
        const [session, deviceToken] = await Promise.all([opts.sessions.load(), opts.sessions.deviceToken()]);
        if (session?.token) config.headers.set('Authorization', `Bearer ${session.token}`);
        if (deviceToken) config.headers.set('X-Device-Token', deviceToken);
        return config;
    });

    http.interceptors.response.use(
        (response) => response,
        async (error) => {
            if (error?.response?.status === 401 && !isCredentialRequest(error.config?.url)) {
                // Only the session goes; the device token and any local data stay.
                await opts.sessions.clear();
                appEvents.emit('session-expired');
            }
            return Promise.reject(error);
        },
    );

    return http;
}
