import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl, resolveWebSocketBaseUrl } from './runtime-routing';

const railwayWebLocation = {
    hostname: 'miapitza-web-production.up.railway.app',
    host: 'miapitza-web-production.up.railway.app',
    protocol: 'https:',
};

describe('runtime routing', () => {
    it('forces API and WebSocket traffic through the same-origin production proxy', () => {
        expect(resolveApiBaseUrl('https://miapitza-production.up.railway.app/api', true, railwayWebLocation))
            .toBe('/api');
        expect(resolveWebSocketBaseUrl('wss://miapitza-production.up.railway.app', true, railwayWebLocation))
            .toBe('wss://miapitza-web-production.up.railway.app/ws');
    });

    it('preserves explicit endpoints when the proxy is disabled', () => {
        expect(resolveApiBaseUrl('https://api.example.com/api/', false, railwayWebLocation))
            .toBe('https://api.example.com/api');
        expect(resolveWebSocketBaseUrl('wss://api.example.com', false, railwayWebLocation))
            .toBe('wss://api.example.com');
    });

    it('keeps legacy Railway discovery only as a non-proxy fallback', () => {
        expect(resolveApiBaseUrl(undefined, false, railwayWebLocation))
            .toBe('https://miapitza-production.up.railway.app/api');
        expect(resolveWebSocketBaseUrl(undefined, false, railwayWebLocation))
            .toBe('wss://miapitza-production.up.railway.app');
    });
});
