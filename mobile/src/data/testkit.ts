import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { createHttp } from '../core/http';
import { createSessionStore, memoryStore, type Session } from '../core/session';
import { MobileDB } from './cache';

export function sessionFor(userId: number, companyId = 1, token = `jwt-${userId}`): Session {
    return {
        token,
        issuedAt: 1,
        user: { id: userId, name: `U${userId}`, email: 'a@x', username: `u${userId}`, role: { id: 1, name: 'MESERO' }, roles: ['MESERO'], branchId: 1, companyId, permissions: [] },
    };
}

export type Reply = { status?: number; data?: unknown; code?: string; network?: boolean };
export type Seen = { method: string; url: string; data: unknown; key: string | null; auth: string | null };

let counter = 0;

/** Real http + session store + Dexie (fake-indexeddb) with a scripted adapter. */
export function makeEnv() {
    const sessions = createSessionStore(memoryStore());
    const http = createHttp({ baseURL: 'http://x/api', sessions });
    const seen: Seen[] = [];
    let handler: (req: Seen, config: InternalAxiosRequestConfig) => Reply | Promise<Reply> = () => ({});
    const adapter: AxiosAdapter = async (config) => {
        const req: Seen = {
            method: (config.method ?? 'get').toUpperCase(),
            url: config.url ?? '',
            data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
            key: config.headers.get('X-Idempotency-Key') as string | null,
            auth: config.headers.get('Authorization') as string | null,
        };
        seen.push(req);
        const reply = await handler(req, config);
        if (reply.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config);
        const status = reply.status ?? 200;
        const response = { data: reply.data ?? { success: true, data: {} }, status, statusText: '', headers: {}, config };
        if (status >= 400) {
            response.data = { success: false, message: 'err', code: reply.code, ...(reply.data as object) };
            throw new AxiosError('fail', String(status), config, null, response);
        }
        return response;
    };
    http.defaults.adapter = adapter;
    const db = new MobileDB(`test-${++counter}-${Date.now()}`);
    let online = true;
    return {
        sessions,
        http,
        db,
        seen,
        reply: (fn: typeof handler) => {
            handler = fn;
        },
        setOnline: (v: boolean) => {
            online = v;
        },
        isOnline: () => online,
    };
}
