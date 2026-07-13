import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAssetUrl } from './assets';

describe('resolveAssetUrl', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('preserves absolute and embedded assets', () => {
        expect(resolveAssetUrl('https://cdn.example/logo.png')).toBe('https://cdn.example/logo.png');
        expect(resolveAssetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });

    it('resolves legacy upload paths against the API service origin', () => {
        vi.stubEnv('VITE_API_URL', 'https://api.example.com/api');
        expect(resolveAssetUrl('/uploads/x.png')).toBe('https://api.example.com/uploads/x.png');
    });
});
