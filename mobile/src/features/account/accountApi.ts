import type { AxiosInstance } from 'axios';
import type { createRealtime } from '../../core/realtime';
import type { Session, SessionStore } from '../../core/session';

export type AccountLoginResult = { status: 'ok'; session: Session } | { status: '2fa' };

export interface AccountApi {
    login(username: string, password: string, twoFactorCode?: string): Promise<AccountLoginResult>;
    logout(): Promise<void>;
}

type RealtimeControl = Pick<ReturnType<typeof createRealtime>, 'close' | 'reconnect'>;

export function createAccountApi(deps: { http: AxiosInstance; sessions: SessionStore; realtime: RealtimeControl }): AccountApi {
    const { http, sessions, realtime } = deps;
    return {
        async login(username, password, twoFactorCode) {
            const body: Record<string, string> = { username, password };
            if (twoFactorCode) body.twoFactorCode = twoFactorCode;
            const res = await http.post('/auth/login', body);
            const data = res.data?.data;
            if (data?.requires2FA) return { status: '2fa' };
            if (typeof data?.token !== 'string' || !data.token) throw new Error('login');
            const session: Session = { token: data.token, user: data.user, issuedAt: Date.now() };
            await sessions.save(session);
            await realtime.reconnect();
            return { status: 'ok', session };
        },
        async logout() {
            realtime.close();
            try {
                await http.post('/auth/logout');
            } catch {
                // Offline or already revoked: drop the local session anyway.
            } finally {
                await sessions.clear();
            }
        },
    };
}
