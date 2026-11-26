import type { AxiosAdapter, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { createHttp } from '../core/http';
import { createSessionStore, memoryStore, type LoginUser, type Session } from '../core/session';

export const user: LoginUser = {
    id: 7,
    name: 'Ana Perez',
    email: 'a@x',
    username: 'ana',
    role: { id: 1, name: 'MESERO' },
    roles: ['MESERO'],
    branchId: 1,
    companyId: 1,
    permissions: ['orders.view'],
};

export const session: Session = { token: 'tok-1', issuedAt: 1, user };

export type Handler = (config: InternalAxiosRequestConfig) => { status?: number; data?: unknown } | Promise<{ status?: number; data?: unknown }>;

/** Real createHttp (interceptors included) over a scripted adapter; records every request. */
export function fakeApi(handler: Handler) {
    const sessions = createSessionStore(memoryStore());
    const http: AxiosInstance = createHttp({ baseURL: 'http://api.test/api', sessions });
    const calls: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        const { status = 200, data = {} } = await handler(config);
        const response = { data, status, statusText: '', headers: {}, config };
        if (status >= 400) throw new AxiosError('fail', String(status), config, null, response);
        return response;
    };
    http.defaults.adapter = adapter;
    return { http, sessions, calls };
}

export const pathOf = (c: InternalAxiosRequestConfig) => `${(c.method ?? 'get').toUpperCase()} ${c.url}`;
