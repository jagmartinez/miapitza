import type { AxiosInstance } from 'axios';
import type { createRealtime } from '../../core/realtime';
import { lockAndRevoke } from '../../core/revoke';
import type { Session, SessionStore } from '../../core/session';

export type AccountLoginResult = { status: 'ok'; session: Session } | { status: '2fa' };

export interface AccountApi {
    login(username: string, password: string, twoFactorCode?: string): Promise<AccountLoginResult>;
    logout(): Promise<void>;
    /** Server revokes every session on success, so the local one is dropped too. */
    changePassword(oldPassword: string, newPassword: string): Promise<void>;
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
            if (typeof data.mustChangePassword === 'boolean') session.mustChangePassword = data.mustChangePassword;
            if (typeof data.passwordExpired === 'boolean') session.passwordExpired = data.passwordExpired;
            if (typeof data.sessionTimeoutMinutes === 'number') session.sessionTimeoutMinutes = data.sessionTimeoutMinutes;
            await sessions.save(session);
            await realtime.reconnect();
            return { status: 'ok', session };
        },
        async changePassword(oldPassword, newPassword) {
            await http.post('/auth/change-password', { oldPassword, newPassword });
            realtime.close();
            try {
                await sessions.clear();
            } catch {
                // The server already revoked every session; login must still be reached.
            }
        },
        async logout() {
            await lockAndRevoke({ http, sessions, realtime });
        },
    };
}
