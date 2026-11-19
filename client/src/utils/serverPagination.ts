export interface ServerPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

const toPositiveInt = (value: unknown): number | null => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * Normalize the `{ pagination: { page, limit, total, totalPages? } }` envelope the
 * list endpoints return. When the server omits it (older builds, cached payloads)
 * fall back to the rows actually received so the UI never invents extra pages.
 */
export function readServerPagination(
    payload: unknown,
    rowCount: number,
    fallbackLimit: number,
    fallbackPage = 1,
): ServerPagination {
    const raw = (payload && typeof payload === 'object'
        ? (payload as { pagination?: Record<string, unknown> }).pagination
        : undefined) ?? {};
    const limit = toPositiveInt(raw.limit) || fallbackLimit;
    const page = toPositiveInt(raw.page) || fallbackPage;
    const total = toPositiveInt(raw.total) ?? (page - 1) * limit + rowCount;
    const explicitPages = toPositiveInt(raw.totalPages ?? raw.pages);
    const totalPages = Math.max(1, explicitPages ?? Math.ceil(total / Math.max(1, limit)));
    return { page, limit, total, totalPages };
}
