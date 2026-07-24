export class ExternalHttpTimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number, cause?: unknown) {
        super(`La integración externa excedió el tiempo límite de ${timeoutMs} ms`);
        this.name = 'ExternalHttpTimeoutError';
        this.timeoutMs = timeoutMs;
        (this as Error & { cause?: unknown }).cause = cause;
    }
}

export function externalHttpTimeoutMs(raw: string | undefined, fallback = 8_000): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 250 || value > 60_000) {
        throw new Error('El timeout HTTP externo debe ser un entero entre 250 y 60000 ms');
    }
    return value;
}

export async function fetchWithTimeout(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = 8_000
): Promise<Response> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new Error('Timeout HTTP externo inválido');
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abortFromCaller();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    timer.unref?.();

    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        if (timedOut) throw new ExternalHttpTimeoutError(timeoutMs, error);
        throw error;
    } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', abortFromCaller);
    }
}
