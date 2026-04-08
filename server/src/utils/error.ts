/**
 * Safe message extraction for caught values (unknown in catch).
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const m = (error as { message?: unknown }).message;
        if (typeof m === 'string') {
            return m;
        }
    }
    return String(error);
}

export interface NormalizedHttpError {
    statusCode: number;
    message: string;
    stack?: string;
}

/**
 * Normalize values passed to Express error middleware (Error or { statusCode?, message? }).
 */
export function normalizeError(err: unknown): NormalizedHttpError {
    if (err instanceof Error) {
        const statusCode =
            typeof (err as Error & { statusCode?: unknown }).statusCode === 'number'
                ? (err as Error & { statusCode: number }).statusCode
                : 500;
        return {
            statusCode,
            message: err.message,
            stack: err.stack,
        };
    }
    if (typeof err === 'object' && err !== null) {
        const o = err as Record<string, unknown>;
        const statusCode = typeof o.statusCode === 'number' ? o.statusCode : 500;
        const message =
            typeof o.message === 'string' ? o.message : 'Error interno del servidor';
        return { statusCode, message };
    }
    return { statusCode: 500, message: String(err) };
}
