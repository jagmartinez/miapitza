import { Capacitor } from '@capacitor/core';
import { createHttp } from './http';
import { createRealtime } from './realtime';
import { createSessionStore, memoryStore, nativeSecureStore } from './session';
import { createDeviceApi } from '../features/device/deviceApi';
import { createPinApi } from '../features/pin/pinApi';
import { createAccountApi } from '../features/account/accountApi';

/** API root, e.g. https://host/api. Set VITE_API_URL at build time. */
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api';

function wsUrlFor(apiUrl: string): string {
    // The socket server shares the HTTP server's origin.
    const url = new URL(apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/';
    return url.toString();
}

export function createServices() {
    // Tokens only ever go to the Keystore-backed store; the browser dev build keeps them in memory.
    const sessions = createSessionStore(Capacitor.isNativePlatform() ? nativeSecureStore() : memoryStore());
    const http = createHttp({ baseURL: API_URL, sessions });
    const realtime = createRealtime({
        url: wsUrlFor(API_URL),
        getToken: async () => (await sessions.load())?.token ?? null,
    });
    return {
        sessions,
        http,
        realtime,
        deviceApi: createDeviceApi({ http, sessions }),
        pinApi: createPinApi({ http, sessions, realtime }),
        accountApi: createAccountApi({ http, sessions, realtime }),
    };
}

export type Services = ReturnType<typeof createServices>;
