import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('catering PDF performance and integrity contract', () => {
    const app = read('src/App.tsx');
    const catering = read('src/pages/Catering.tsx');
    const api = read('src/services/api.ts');
    const packageJson = JSON.parse(read('package.json')) as {
        dependencies: Record<string, string>;
    };

    it('keeps Catering route-lazy and delegates PDF rendering to the authenticated server', () => {
        expect(app).toContain("const Catering = lazy(() => import('./pages/Catering'))");
        expect(catering).toContain('await cateringAPI.downloadContract(event.id)');
        expect(api).toContain("api.get(`/catering/${id}/contract`");
        expect(api).toContain("responseType: 'blob'");
        expect(api).toContain('skipOfflineCache: true');
    });

    it('does not ship React-PDF or a browser PDF worker', () => {
        expect(packageJson.dependencies['@react-pdf/renderer']).toBeUndefined();
        expect(catering).not.toContain('@react-pdf/renderer');
        expect(catering).not.toContain('contractPdf.worker');
        expect(catering).not.toContain('getContractPdfValidationErrors');
    });

    it('rejects non-PDF responses and exposes the backend domain error', () => {
        expect(catering).toContain("contentType.includes('application/pdf')");
        expect(catering).toContain('blob.size === 0');
        expect(catering).toContain('await responseData.text()');
        expect(catering).toContain('parsed.message');
    });
});
