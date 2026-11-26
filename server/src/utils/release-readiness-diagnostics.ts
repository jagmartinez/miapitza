export type SafeReadinessDetails = {
    status?: string;
    checks: Record<string, {
        status?: string;
        required?: boolean;
        mode?: string;
        verified?: boolean;
        provider?: string;
        model?: string;
        version?: string;
    }>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value.slice(0, 100) : undefined;
}

export function safeReadinessDetails(payload: unknown): SafeReadinessDetails | null {
    const envelope = objectValue(payload);
    const data = objectValue(envelope?.data);
    const checks = objectValue(data?.checks);
    if (!data || !checks) return null;

    const safeChecks: SafeReadinessDetails['checks'] = {};
    for (const [name, rawCheck] of Object.entries(checks)) {
        const check = objectValue(rawCheck);
        if (!check) continue;
        const mode = optionalString(check.mode);
        const provider = optionalString(check.provider);
        const model = optionalString(check.model);
        const version = optionalString(check.version);
        safeChecks[name.slice(0, 100)] = {
            status: optionalString(check.status),
            ...(typeof check.required === 'boolean' ? { required: check.required } : {}),
            ...(mode ? { mode } : {}),
            ...(typeof check.verified === 'boolean' ? { verified: check.verified } : {}),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(version ? { version } : {}),
        };
    }
    return { status: optionalString(data.status), checks: safeChecks };
}
