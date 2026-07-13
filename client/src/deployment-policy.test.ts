import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const clientRoot = new URL('../', import.meta.url);

describe('production web deployment policy', () => {
    it('serves same-origin API and WebSocket proxies with explicit cache rules', async () => {
        const [dockerfile, nginx] = await Promise.all([
            readFile(new URL('Dockerfile', clientRoot), 'utf8'),
            readFile(new URL('nginx.conf.template', clientRoot), 'utf8'),
        ]);

        expect(dockerfile).toContain('FROM nginx:1.27-alpine');
        expect(dockerfile).toContain('VITE_API_PROXY_ENABLED=true');
        expect(nginx).toContain('location /api/');
        expect(nginx).toContain('location = /ws');
        expect(nginx).toContain('location = /index.html');
        expect(nginx).toContain('no-store, no-cache, must-revalidate');
        expect(nginx).toContain('location /assets/');
        expect(nginx).toContain('try_files $uri =404');
    });

    it('does not register another fetch-intercepting service worker', async () => {
        const [index, worker] = await Promise.all([
            readFile(new URL('index.html', clientRoot), 'utf8'),
            readFile(new URL('public/sw.js', clientRoot), 'utf8'),
        ]);

        expect(index).not.toContain('serviceWorker.register');
        expect(worker).not.toContain("addEventListener('fetch'");
        expect(worker).toContain('caches.delete');
        expect(worker).toContain('registration.unregister');
        expect(worker).not.toContain("'/index.html'");
    });
});
