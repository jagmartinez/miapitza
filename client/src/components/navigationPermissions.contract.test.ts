import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');

describe('effective navigation permissions', () => {
    it('uses effective permissions for route guards while retaining role fallback', () => {
        expect(appSource).toContain('hasPermission(user, permission, roles)');
        expect(appSource).toContain('permission="tables.map.view"');
        expect(appSource).toContain('permission="orders.view"');
        expect(appSource).toContain('permission="kds.view"');
        expect(appSource).toContain('permission="invoices.view"');
    });

    it('filters desktop and mobile navigation with the same effective contract', () => {
        expect(layoutSource.match(/hasPermission\(user, item\.permission, item\.roles\)/g)).toHaveLength(2);
        expect(layoutSource).toContain("permission: 'tables.map.view'");
        expect(layoutSource).toContain("permission: 'hr.employee.read'");
    });
});
