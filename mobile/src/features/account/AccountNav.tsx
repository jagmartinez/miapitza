import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type AccountSection =
    | 'home'
    | 'punch'
    | 'schedule'
    | 'payroll'
    | 'info'
    | 'leave'
    | 'overtime'
    | 'correction'
    | 'swap'
    | 'loanRequest'
    | 'loans'
    | 'approvals';

export type SectionParams = Record<string, unknown>;

export interface AccountNav {
    section: AccountSection;
    params: SectionParams;
    /** Opens a section on top of the current one ('home' resets the stack). */
    navigate: (section: AccountSection, params?: SectionParams) => void;
    /** Back to the previous section (stays on home when there is none). */
    back: () => void;
}

const NavContext = createContext<AccountNav | null>(null);

interface Entry {
    section: AccountSection;
    params: SectionParams;
}

/** Tiny in-shell stack navigator: no router library, state lives with the mounted shell tree. */
export function AccountNavProvider({ children }: { children: ReactNode }) {
    const [stack, setStack] = useState<Entry[]>([{ section: 'home', params: {} }]);
    const navigate = useCallback((section: AccountSection, params: SectionParams = {}) => {
        setStack((s) => (section === 'home' ? [s[0]] : [...s, { section, params }]));
    }, []);
    const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
    const top = stack[stack.length - 1];
    const value = useMemo(() => ({ section: top.section, params: top.params, navigate, back }), [top, navigate, back]);
    return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useAccountNav(): AccountNav {
    const ctx = useContext(NavContext);
    if (!ctx) throw new Error('useAccountNav outside AccountNavProvider');
    return ctx;
}
