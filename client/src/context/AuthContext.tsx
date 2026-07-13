import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { authAPI } from '../services/api';
import { closeWebSocket } from '../utils/websocket';
import { offlineManager } from '../services/offlineManager';
import { AuthContext } from './auth-context';
import type { User } from '../types';
import { isAuthoritativeSessionFailure } from '../utils/auth-session';

/**
 * Normalize the roles payload from /auth/me (string names from the JWT, or
 * objects) into the `{ id, name }[]` shape used across the client.
 */
const mapServerRoles = (raw: unknown): { id: number; name: string }[] | undefined => {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const mapped = raw
        .map((entry, index): { id: number; name: string } | null => {
            if (typeof entry === 'string') {
                return { id: index, name: entry };
            }
            if (entry && typeof entry === 'object') {
                const candidate = entry as { id?: number; name?: string; role?: { id?: number; name?: string } };
                const name = candidate.name ?? candidate.role?.name;
                if (typeof name === 'string' && name) {
                    return { id: candidate.id ?? candidate.role?.id ?? index, name };
                }
            }
            return null;
        })
        .filter((role): role is { id: number; name: string } => role !== null);
    return mapped.length > 0 ? mapped : undefined;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [passwordExpired, setPasswordExpired] = useState(false);
    const [sessionTimeout, setSessionTimeout] = useState(30);
    const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const logoutInFlight = useRef<Promise<void> | null>(null);

    const logout = useCallback(async () => {
        if (logoutInFlight.current) return logoutInFlight.current;

        const operation = (async () => {
            try {
                await authAPI.logout();
            } catch {
                // Local logout must remain available during network/API outages.
            } finally {
                closeWebSocket();
                await offlineManager.clearSessionData();
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('authFlags');
                setUser(null);
                setMustChangePassword(false);
                setPasswordExpired(false);

                if (inactivityTimer.current) {
                    clearTimeout(inactivityTimer.current);
                }
            }
        })();

        logoutInFlight.current = operation;
        try {
            await operation;
        } finally {
            logoutInFlight.current = null;
        }
    }, []);

    const resetTimer = useCallback(() => {
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
        if (user && sessionTimeout > 0) {
            inactivityTimer.current = setTimeout(() => {
                logout();
                window.location.href = '/login';
            }, sessionTimeout * 60 * 1000);
        }
    }, [logout, sessionTimeout, user]);

    useEffect(() => {
        if (!user) return;
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        events.forEach(eventName => window.addEventListener(eventName, resetTimer, { passive: true }));
        resetTimer();

        return () => {
            events.forEach(eventName => window.removeEventListener(eventName, resetTimer));
            if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
        };
    }, [resetTimer, user]);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const storedFlags = localStorage.getItem('authFlags');

        if (!storedUser) {
            setIsLoading(false);
            return;
        }

        try {
            const parsed = JSON.parse(storedUser);
            if (!parsed || typeof parsed !== 'object' || !parsed.id) {
                throw new Error('Invalid user data in localStorage');
            }

            setUser(parsed);

            if (storedFlags) {
                const flags = JSON.parse(storedFlags);
                setMustChangePassword(flags.mustChangePassword || false);
                setPasswordExpired(flags.passwordExpired || false);
                setSessionTimeout(flags.sessionTimeoutMinutes || 30);
            }
        } catch {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            localStorage.removeItem('authFlags');
            setIsLoading(false);
            return;
        }

        authAPI.me()
            .then(res => {
                const serverUser = res.data?.data;
                if (serverUser) {
                    const safeFields = { ...serverUser };
                    delete safeFields.userId;
                    delete safeFields.role;
                    delete safeFields.roles;
                    delete safeFields.userRoles;
                    delete safeFields.company;
                    // /auth/me returns the JWT shape with roles as string names. Reflect
                    // any server-side role changes by mapping them into user.roles, which
                    // is the canonical source consumed by getUserRoleNames().
                    const refreshedRoles = mapServerRoles(serverUser.roles ?? serverUser.userRoles);
                    setUser((prev) => (prev
                        ? { ...prev, ...safeFields, ...(refreshedRoles ? { roles: refreshedRoles } : {}) }
                        : prev));
                }
            })
            .catch((error: unknown) => {
                // A timeout, deployment restart or temporary network failure is not
                // proof that the server revoked the session. Keep the owner-scoped
                // offline state and let the global 401 interceptor handle a real
                // authentication rejection.
                if (isAuthoritativeSessionFailure(error)) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    localStorage.removeItem('authFlags');
                    setUser(null);
                }
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = async (username: string, password: string, twoFactorCode?: string): Promise<{ requires2FA?: boolean }> => {
        try {
            const response = await authAPI.login(username, password, twoFactorCode);
            const data = response.data.data;

            if (data.requires2FA) {
                return { requires2FA: true };
            }

            const {
                user: userData,
                mustChangePassword: mustUpdatePassword,
                passwordExpired: isPasswordExpired,
                sessionTimeoutMinutes
            } = data;

            // The offline database is not shared across authenticated identities.
            await offlineManager.clearSessionData();
            localStorage.removeItem('token');
            localStorage.setItem('user', JSON.stringify(userData));
            localStorage.setItem('authFlags', JSON.stringify({
                mustChangePassword: mustUpdatePassword || false,
                passwordExpired: isPasswordExpired || false,
                sessionTimeoutMinutes: sessionTimeoutMinutes || 30,
            }));

            setUser(userData);
            setMustChangePassword(mustUpdatePassword || false);
            setPasswordExpired(isPasswordExpired || false);
            setSessionTimeout(sessionTimeoutMinutes || 30);
            return {};
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            throw new Error(axiosErr.response?.data?.message || 'Login failed');
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, isLoading, mustChangePassword, passwordExpired }}>
            {children}
        </AuthContext.Provider>
    );
};
