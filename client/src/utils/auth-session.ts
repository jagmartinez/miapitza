export function isAuthoritativeSessionFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const response = (error as { response?: { status?: unknown } }).response;
    return response?.status === 401;
}
