import { usersAPI } from '../services/api';
import { setUiPrefs } from '../ui';

export type NotificationMatrix = Record<string, Record<string, boolean>>;

export interface UserPreferences {
    density: 'comfortable' | 'compact';
    rowsPerPage: 10 | 25 | 50 | 100;
    homePage: string | null;
    defaultBranchId: number | null;
    numberFormat: 'es-NI' | 'en-US';
    notifications: NotificationMatrix;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    density: 'comfortable',
    rowsPerPage: 25,
    homePage: null,
    defaultBranchId: null,
    numberFormat: 'es-NI',
    notifications: {},
};

const cacheKey = (userId: number) => `uiPrefs:${userId}`;

function safeStorage<T>(fn: () => T): T | undefined {
    try { return fn(); } catch { return undefined; }
}

export function applyUserPreferences(userId: number, prefs: Partial<UserPreferences>): void {
    setUiPrefs({ density: prefs.density, rowsPerPage: prefs.rowsPerPage });
    safeStorage(() => localStorage.setItem(cacheKey(userId), JSON.stringify(prefs)));
}

export function readCachedPreferences(userId: number): Partial<UserPreferences> | null {
    const raw = safeStorage(() => localStorage.getItem(cacheKey(userId)));
    if (!raw) return null;
    try { return JSON.parse(raw) as Partial<UserPreferences>; } catch { return null; }
}

/** Carga las preferencias del usuario: primero la copia local (arranque inmediato), luego la del servidor. */
export async function loadUserPreferences(userId: number): Promise<UserPreferences | null> {
    const cached = readCachedPreferences(userId);
    if (cached) setUiPrefs({ density: cached.density, rowsPerPage: cached.rowsPerPage });
    try {
        const res = await usersAPI.getPreferences();
        const prefs = { ...DEFAULT_USER_PREFERENCES, ...(res.data?.data as Partial<UserPreferences>) };
        applyUserPreferences(userId, prefs);
        return prefs;
    } catch {
        return null; // sin red se conserva la copia local o los valores por defecto
    }
}

export async function saveUserPreferences(userId: number, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const res = await usersAPI.updatePreferences(patch as Record<string, unknown>);
    const prefs = { ...DEFAULT_USER_PREFERENCES, ...(res.data?.data as Partial<UserPreferences>) };
    applyUserPreferences(userId, prefs);
    return prefs;
}
