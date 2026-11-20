import type { AxiosInstance } from 'axios';
import type { DeviceType, LoginUser, SessionStore } from '../../core/session';

export interface RegisterInput {
    branchId: number;
    type: DeviceType;
    name: string;
    kitchenUserId?: number;
}

export type AdminLoginResult = { status: 'ok'; user: LoginUser } | { status: '2fa' };

export interface DeviceApi {
    /** Password login of an administrator. The session is held privately, never stored as the app session. */
    adminLogin(username: string, password: string, twoFactorCode?: string): Promise<AdminLoginResult>;
    /** Registers the device (PERSONAL only records the type), then drops the admin session. */
    register(input: RegisterInput): Promise<{ deviceType: DeviceType; deviceToken?: string }>;
    /** Abandons setup: revokes the admin session if one is held. */
    cancel(): Promise<void>;
}

export function createDeviceApi(deps: { http: AxiosInstance; sessions: SessionStore }): DeviceApi {
    const { http, sessions } = deps;
    // Lives only in this closure: the request interceptor would otherwise treat it as the app session.
    let adminToken: string | null = null;

    async function dropAdminSession() {
        const token = adminToken;
        adminToken = null;
        if (!token) return;
        try {
            await http.post('/auth/logout', undefined, { headers: { Authorization: `Bearer ${token}` } });
        } catch {
            // Best effort: the token is already forgotten locally and expires server-side.
        }
    }

    return {
        async adminLogin(username, password, twoFactorCode) {
            await dropAdminSession();
            // No app session may shadow the admin token on the next request.
            await sessions.clear();
            const body: Record<string, string> = { username, password };
            if (twoFactorCode) body.twoFactorCode = twoFactorCode;
            const res = await http.post('/auth/login', body);
            const data = res.data?.data;
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
            return { deviceType: input.type, deviceToken };
        },

        cancel: dropAdminSession,
    };
}
