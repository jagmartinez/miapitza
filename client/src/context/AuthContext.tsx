import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { authAPI } from '../services/api';
import { closeWebSocket } from '../utils/websocket';
import { AuthContext } from './auth-context';
import type { User } from '../types';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [passwordExpired, setPasswordExpired] = useState(false);
    const [sessionTimeout, setSessionTimeout] = useState(30);
    const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const logout = useCallback(() => {
        authAPI.getSessions?.()
            .then(res => {
                const currentSession = res?.data?.data?.find?.((s: { id: string; isCurrent: boolean }) => s.isCurrent);
                if (currentSession) {
                    authAPI.revokeSession?.(currentSession.id).catch(() => {});
                }
            })
            .catch(() => {});

        closeWebSocket();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('authFlags');
        setUser(null);
        setMustChangePassword(false);
        setPasswordExpired(false);

        if (inactivityTimer.current) {
            clearTimeout(inactivityTimer.current);
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
                    setUser((prev) => (prev ? { ...prev, ...safeFields } : prev));
                }
            })
            .catch(() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('authFlags');
                setUser(null);
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
                token,
                user: userData,
                mustChangePassword: mustUpdatePassword,
                passwordExpired: isPasswordExpired,
                sessionTimeoutMinutes
            } = data;

            if (token) {
                // Backward compatibility during migration from Bearer-only auth.
                localStorage.setItem('token', token);
            } else {
                localStorage.removeItem('token');
            }
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
