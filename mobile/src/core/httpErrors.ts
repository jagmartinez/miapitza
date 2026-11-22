/** HTTP status of a failed axios request, or undefined for network errors / non-axios errors. */
export function httpStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof status === 'number' ? status : undefined;
}

/** Domain `code` of a failed request's JSON body (e.g. DEVICE_NOT_ACTIVE), if the server sent one. */
export function httpCode(error: unknown): string | undefined {
    const code = (error as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
    return typeof code === 'string' ? code : undefined;
}

/** Human message of a failed request's JSON body, if the server sent one. */
export function httpMessage(error: unknown): string | undefined {
    const message = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
    return typeof message === 'string' && message.trim() ? message : undefined;
}
