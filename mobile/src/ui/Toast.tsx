import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './ui-kit.css';

export type ToastTone = 'info' | 'error';
interface ToastItem {
    id: number;
    message: string;
    tone: ToastTone;
}
interface ToastApi {
    show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

    const show = useCallback((message: string, tone: ToastTone = 'info') => {
        const id = nextId.current++;
        setItems((cur) => [...cur.slice(-2), { id, message, tone }]);
        const t = setTimeout(() => {
            timers.current.delete(t);
            setItems((cur) => cur.filter((i) => i.id !== id));
        }, DURATION_MS);
        timers.current.add(t);
    }, []);

    useEffect(() => {
        const set = timers.current;
        return () => set.forEach(clearTimeout);
    }, []);

    const api = useMemo(() => ({ show }), [show]);
    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="ui-toasts" role="status" aria-live="polite">
                {items.map((i) => (
                    <div key={i.id} className={`ui-toast ${i.tone === 'error' ? 'ui-toast-error' : ''}`}>
                        {i.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

/** Outside a provider the hook is a no-op so a screen never crashes for want of a toast. */
export function useToast(): ToastApi {
    return useContext(ToastContext) ?? { show: () => undefined };
}
