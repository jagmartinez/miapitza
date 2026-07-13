type BrowserLocation = {
    hostname: string;
    host: string;
    protocol: string;
};

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export function resolveApiBaseUrl(
    envUrl: string | undefined,
    sameOriginProxy: boolean,
    location?: Pick<BrowserLocation, 'hostname'>,
): string {
    if (sameOriginProxy) return '/api';
    if (envUrl) return trimTrailingSlashes(envUrl);

    const host = location?.hostname;
    if (host?.includes('-web-') && host.endsWith('.up.railway.app')) {
        return `https://${host.replace('-web-', '-')}/api`;
    }
    return '/api';
}

export function resolveWebSocketBaseUrl(
    envUrl: string | undefined,
    sameOriginProxy: boolean,
    location?: BrowserLocation,
): string {
    if (sameOriginProxy && location) {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}/ws`;
    }
    if (envUrl) return envUrl;

    if (location) {
        if (location.hostname.includes('-web-') && location.hostname.endsWith('.up.railway.app')) {
            return `wss://${location.hostname.replace('-web-', '-')}`;
        }
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}`;
    }
    return 'ws://localhost:3000';
}
