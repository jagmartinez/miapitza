export function isAuthoritativeSessionFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const response = (error as { response?: { status?: unknown } }).response;
    return response?.status === 401;
}

export interface NormalizedSessionRole {
    id: number;
    name: string;
}

/**
 * Preserve the distinction between an omitted roles field and an explicit
 * empty array. The latter is an authoritative revocation and must clear roles
 * cached from the previous session snapshot.
 */
export function normalizeSessionRoles(raw: unknown): NormalizedSessionRole[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    return raw
        .map((entry, index): NormalizedSessionRole | null => {
            if (typeof entry === 'string') {
                return entry ? { id: index, name: entry } : null;
            }
            if (entry && typeof entry === 'object') {
                const candidate = entry as {
                    id?: number;
                    name?: string;
                    role?: { id?: number; name?: string };
                };
                const name = candidate.name ?? candidate.role?.name;
                if (typeof name === 'string' && name) {
                    return { id: candidate.id ?? candidate.role?.id ?? index, name };
                }
            }
            return null;
        })
        .filter((role): role is NormalizedSessionRole => role !== null);
}
