import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8');

describe('survey NPS wiring', () => {
    it('guards the /encuestas route with surveys.view', () => {
        expect(app).toMatch(/path="\/encuestas"[^\n]*permission="surveys\.view"/);
    });

    it('shows the nav item only through the shared permission filter (hidden without surveys.view)', () => {
        expect(layout).toContain("permission: 'surveys.view'");
        expect(layout.match(/hasPermission\(user, item\.permission, item\.roles\)/g)).toHaveLength(2);
    });

    it('calls the v1 survey endpoints', () => {
        expect(api).toContain("'/v1/surveys'");
    });
});
