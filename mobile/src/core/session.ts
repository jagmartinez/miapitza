/** Shape of `data.user` returned by POST /api/auth/login, pin-login and device-login. */
export interface LoginUser {
    id: number;
    name: string;
    email: string;
    username: string;
    role: { id: number; name: string };
    roles: string[];
    branchId: number | null;
    companyId: number | null;
    company?: unknown;
    color?: string | null;
    accountType?: string;
    employeeId?: number;
    permissions: unknown;
}

export type Session = { token: string; user: LoginUser; issuedAt: number };

export interface SecureStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

export function memoryStore(): SecureStore {
    const data = new Map<string, string>();
    return {
        async get(key) {
            return data.get(key) ?? null;
        },
        async set(key, value) {
            data.set(key, value);
        },
        async remove(key) {
            data.delete(key);
        },
    };
}

/**
 * Android Keystore / iOS Keychain backed storage via
 * @aparajita/capacitor-secure-storage (6.x matches Capacitor 6). Loaded lazily so
 * it stays out of the initial bundle. Tokens are never written to localStorage.
 */
export function nativeSecureStore(): SecureStore {
    const plugin = async () => {
        const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
        return SecureStorage;
    };
    return {
        async get(key) {
            const value = await (await plugin()).getItem(key);
            return typeof value === 'string' ? value : null;
        },
        async set(key, value) {
            await (await plugin()).setItem(key, value);
        },
        async remove(key) {
            await (await plugin()).removeItem(key);
        },
    };
}

const SESSION_KEY = 'session';
const DEVICE_TOKEN_KEY = 'deviceToken';
const DEVICE_TYPE_KEY = 'deviceType';

export type DeviceType = 'SERVICE_TABLET' | 'KITCHEN_TABLET' | 'PERSONAL';
const DEVICE_TYPES: readonly string[] = ['SERVICE_TABLET', 'KITCHEN_TABLET', 'PERSONAL'];

export function createSessionStore(store: SecureStore) {
    return {
        async load(): Promise<Session | null> {
            const raw = await store.get(SESSION_KEY);
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw) as Session;
                return typeof parsed?.token === 'string' && parsed.token ? parsed : null;
            } catch {
                return null;
            }
        },
        async save(session: Session): Promise<void> {
            await store.set(SESSION_KEY, JSON.stringify(session));
        },
        /** Drops only the user session; the paired device token survives. */
        async clear(): Promise<void> {
            await store.remove(SESSION_KEY);
        },
        async deviceToken(): Promise<string | null> {
            return store.get(DEVICE_TOKEN_KEY);
        },
        async saveDeviceToken(token: string): Promise<void> {
            await store.set(DEVICE_TOKEN_KEY, token);
        },
        async deviceType(): Promise<DeviceType | null> {
            const value = await store.get(DEVICE_TYPE_KEY);
            return value && DEVICE_TYPES.includes(value) ? (value as DeviceType) : null;
        },
        async saveDeviceType(type: DeviceType): Promise<void> {
            await store.set(DEVICE_TYPE_KEY, type);
        },
        /** Unpairs the device (revoked or reset): token and type go together. */
        async clearDevice(): Promise<void> {
            await store.remove(DEVICE_TOKEN_KEY);
            await store.remove(DEVICE_TYPE_KEY);
        },
    };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
