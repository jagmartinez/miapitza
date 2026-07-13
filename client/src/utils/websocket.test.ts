import { describe, expect, it } from 'vitest';
import { buildWebSocketUrl } from './websocket';

describe('buildWebSocketUrl', () => {
    it('returns the base URL as-is (token no longer in URL for security)', () => {
        expect(buildWebSocketUrl('ws://localhost:3001'))
            .toBe('ws://localhost:3001');
    });

    it('preserves the URL without adding token', () => {
        expect(buildWebSocketUrl('ws://localhost:3001/socket?branch=4'))
            .toBe('ws://localhost:3001/socket?branch=4');
    });

    it('normalizes accidental HTTP(S) build-time values to WebSocket schemes', () => {
        expect(buildWebSocketUrl('https://api.example.com')).toBe('wss://api.example.com');
        expect(buildWebSocketUrl(' http://localhost:3000 ')).toBe('ws://localhost:3000');
    });
});
