import { appEvents } from './events';

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

export type Session = {
    token: string;
    user: LoginUser;
    issuedAt: number;
    /** Personal-phone login flags: the server blocks everything but change-password while either is set. */
    mustChangePassword?: boolean;
    passwordExpired?: boolean;
    sessionTimeoutMinutes?: number;
};

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
 * An unreadable value (lost Keystore key, plugin failure) reads as absent so the
 * app falls back to setup / PIN instead of bricking; writes still throw so the
 * session store can report them.
 */
export function nativeSecureStore(): SecureStore {
    // Resolve to the module, never to the plugin itself: a Capacitor plugin is a
    // Proxy whose `.then` throws ("SecureStorage.then() is not implemented"), so
    // resolving a promise with it would break every read and write.
    const plugin = () => import('@aparajita/capacitor-secure-storage');
    return {
        async get(key) {
            try {
                const value = await (await plugin()).SecureStorage.getItem(key);
                return typeof value === 'string' ? value : null;
            } catch {
                return null;
            }
        },
        async set(key, value) {
            await (await plugin()).SecureStorage.setItem(key, value);
        },
        async remove(key) {
            try {
                await (await plugin()).SecureStorage.removeItem(key);
            } catch {
                // Nothing readable to remove, or the plugin failed: the key is as good as gone.
            }
        },
    };
}

const SESSION_KEY = 'session';
const DEVICE_TOKEN_KEY = 'deviceToken';
const DEVICE_TYPE_KEY = 'deviceType';
const BRANCH_NAME_KEY = 'branchName';

export type DeviceType = 'SERVICE_TABLET' | 'KITCHEN_TABLET' | 'PERSONAL';
const DEVICE_TYPES: readonly string[] = ['SERVICE_TABLET', 'KITCHEN_TABLET', 'PERSONAL'];

export function createSessionStore(store: SecureStore) {
    // Write-through cache: after the first read, the Keystore is only written to.
    const cache = new Map<string, string | null>();

    /** Non-secret diagnostic: which operation failed, never the value. */
    const reportFailure = (op: 'read' | 'write' | 'remove', key: string) =>
        appEvents.emit('storage-error', { op, key });

    async function read(key: string): Promise<string | null> {
        if (cache.has(key)) return cache.get(key) ?? null;
        let value: string | null = null;
        try {
            value = await store.get(key);
        } catch {
            reportFailure('read', key);
        }
        // A write that landed while the read was in flight wins.
        if (!cache.has(key)) cache.set(key, value);
        return cache.get(key) ?? null;
    }

    async function write(key: string, value: string): Promise<void> {
        cache.set(key, value); // memory first: the app keeps working if the Keystore fails
        try {
            await store.set(key, value);
        } catch {
            reportFailure('write', key);
        }
    }

    async function remove(key: string): Promise<void> {
        cache.set(key, null);
        try {
            await store.remove(key);
        } catch {
            reportFailure('remove', key);
        }
    }

    return {
        async load(): Promise<Session | null> {
            const raw = await read(SESSION_KEY);
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw) as Session;
                return typeof parsed?.token === 'string' && parsed.token ? parsed : null;
            } catch {
                return null;
            }
        },
        save: (session: Session): Promise<void> => write(SESSION_KEY, JSON.stringify(session)),
        /** Drops only the user session; the paired device token survives. The memory copy goes synchronously. */
        clear: (): Promise<void> => remove(SESSION_KEY),
        deviceToken: (): Promise<string | null> => read(DEVICE_TOKEN_KEY),
        saveDeviceToken: (token: string): Promise<void> => write(DEVICE_TOKEN_KEY, token),
        async deviceType(): Promise<DeviceType | null> {
            const value = await read(DEVICE_TYPE_KEY);
            return value && DEVICE_TYPES.includes(value) ? (value as DeviceType) : null;
        },
        saveDeviceType: (type: DeviceType): Promise<void> => write(DEVICE_TYPE_KEY, type),
        /** Branch name of this paired device (display only); null when the server never sent it. */
        branchName: (): Promise<string | null> => read(BRANCH_NAME_KEY),
        saveBranchName: (name: string): Promise<void> => write(BRANCH_NAME_KEY, name),
        /** Unpairs the device (revoked or reset): token, type and branch go together. */
        async clearDevice(): Promise<void> {
            await Promise.all([remove(DEVICE_TOKEN_KEY), remove(DEVICE_TYPE_KEY), remove(BRANCH_NAME_KEY)]);
        },
    };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
