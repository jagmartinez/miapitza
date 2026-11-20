/** HTTP status of a failed axios request, or undefined for network errors / non-axios errors. */
export function httpStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof status === 'number' ? status : undefined;
}
