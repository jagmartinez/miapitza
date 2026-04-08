import { createContext } from 'react';
import type { User } from '../types';

export interface AuthContextType {
    user: User | null;
    login: (username: string, password: string, twoFactorCode?: string) => Promise<{ requires2FA?: boolean }>;
    logout: () => void;
    isLoading: boolean;
    mustChangePassword: boolean;
    passwordExpired: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
