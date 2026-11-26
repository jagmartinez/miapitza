import { useCallback, useEffect, useRef, useState } from 'react';

export interface SectionState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    reload(): void;
}

function messageOf(error: unknown, fallback: string): string {
    const e = error as { response?: { data?: { message?: unknown } }; message?: unknown } | null;
    const fromApi = e?.response?.data?.message;
    if (typeof fromApi === 'string' && fromApi) return fromApi;
    return fallback;
}

/**
 * Carga una sección de forma independiente: cada una tiene su propio estado de carga y error,
 * de modo que una que falla no tumba a las demás. Una respuesta vieja nunca pisa a una nueva.
 */
export function useSection<T>(
    load: (signal: AbortSignal) => Promise<T>,
    deps: readonly unknown[],
    fallbackError: string,
    enabled = true,
): SectionState<T> {
    const loadRef = useRef(load);
    loadRef.current = load;
    const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: enabled, error: null });
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!enabled) return undefined;
        const controller = new AbortController();
        setState((prev) => ({ ...prev, loading: true, error: null }));
        loadRef.current(controller.signal)
            .then((data) => { if (!controller.signal.aborted) setState({ data, loading: false, error: null }); })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                setState((prev) => ({ data: prev.data, loading: false, error: messageOf(error, fallbackError) }));
            });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, nonce, enabled]);

    const reload = useCallback(() => setNonce((n) => n + 1), []);
    return { ...state, reload };
}
