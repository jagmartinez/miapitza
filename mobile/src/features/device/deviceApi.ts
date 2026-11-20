import type { AxiosInstance } from 'axios';
import type { DeviceType, LoginUser, SessionStore } from '../../core/session';

export interface RegisterInput {
    branchId: number;
    type: DeviceType;
    name: string;
    kitchenUserId?: number;
}

export type AdminLoginResult = { status: 'ok'; user: LoginUser } | { status: '2fa' } | { status: 'cancelled' };

export interface DeviceApi {
    /** Password login of an administrator. The session is held privately, never stored as the app session. */
    adminLogin(username: string, password: string, twoFactorCode?: string): Promise<AdminLoginResult>;
    /** Registers the device (PERSONAL only records the type), then drops the admin session. */
    register(input: RegisterInput): Promise<{ deviceType: DeviceType }>;
    /** Abandons setup: revokes the admin session if one is held and voids any login still in flight. */
    cancel(): Promise<void>;
}

export function createDeviceApi(deps: { http: AxiosInstance; sessions: SessionStore }): DeviceApi {
    const { http, sessions } = deps;
    // Lives only in this closure: the request interceptor would otherwise treat it as the app session.
    let adminToken: string | null = null;
    // Bumped by cancel(): a login that resolves after it must discard its token.
    let generation = 0;

    async function revokeToken(token: string) {
        try {
            await http.post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${token}` } });
        } catch {
            // Best effort: the token is already forgotten locally and expires server-side.
        }
    }

    async function dropAdminSession() {
        const token = adminToken;
        adminToken = null;
        if (token) await revokeToken(token);
    }

    return {
        async adminLogin(username, password, twoFactorCode) {
            const mine = ++generation;
            await dropAdminSession();
            if (mine !== generation) return { status: 'cancelled' };
            // No app session may shadow the admin token on the next request.
            await sessions.clear();
            const body: Record<string, string> = { username, password };
            if (twoFactorCode) body.twoFactorCode = twoFactorCode;
            const res = await http.post('/auth/login', body);
            const data = res.data?.data;
            if (mine !== generation) {
                // Cancelled while in flight: a live admin session must not outlive the setup screen.
                if (typeof data?.token === 'string' && data.token) void revokeToken(data.token);
                return { status: 'cancelled' };
            }
            if (data?.requires2FA) return { status: '2fa' };
            if (typeof data?.token !== 'string' || !data.token) throw new Error('login');
            adminToken = data.token;
            return { status: 'ok', user: data.user as LoginUser };
        },

        async register(input) {
            if (input.type === 'PERSONAL') {
                await sessions.saveDeviceType('PERSONAL');
                return { deviceType: 'PERSONAL' };
            }
            if (!adminToken) throw new Error('admin login required');
            const body: Record<string, unknown> = { branchId: input.branchId, type: input.type, name: input.name };
            if (input.kitchenUserId !== undefined) body.kitchenUserId = input.kitchenUserId;
            const res = await http.post('/v1/operational-devices', body, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            const deviceToken = res.data?.data?.deviceToken;
            if (typeof deviceToken !== 'string' || !deviceToken) throw new Error('register');
            // Pair first, then drop the admin session: a failed logout must not unpair the device.
            await sessions.saveDeviceToken(deviceToken);
            await sessions.saveDeviceType(input.type);
            await dropAdminSession();
            return { deviceType: input.type };
        },

        cancel() {
            generation++;
            return dropAdminSession();
        },
    };
}
