import { readFileSync } from 'node:fs';
import { hasPermission } from '../utils/authz';
import type { User } from '../types';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8');

describe('survey NPS wiring', () => {
    it('guards the /encuestas route with surveys.view', () => {
        expect(app).toMatch(/path="\/encuestas"[^\n]*permission="surveys\.view"/);
    });

    it('registers the nav item behind surveys.view in the shared filter', () => {
        expect(layout).toContain("permission: 'surveys.view'");
        expect(layout.match(/hasPermission\(user, item\.permission, item\.roles\)/g)).toHaveLength(2);
    });

    it('hides the item (hasPermission false) without surveys.view and shows it with it', () => {
        const admins = ['SUPERADMIN', 'ADMIN'];
        const withPerm = { permissions: ['surveys.view'] } as unknown as User;
        const without = { permissions: ['view_reports'], role: { name: 'ADMIN' } } as unknown as User;
        expect(hasPermission(withPerm, 'surveys.view', admins)).toBe(true);
        expect(hasPermission(without, 'surveys.view', admins)).toBe(false);
        expect(hasPermission(null, 'surveys.view', admins)).toBe(false);
    });

    it('calls the v1 survey endpoints', () => {
        expect(api).toContain("'/v1/surveys'");
    });
});
