import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const layoutStyles = readFileSync(new URL('./Layout.css', import.meta.url), 'utf8');

describe('responsive global navigation contract', () => {
    it('keeps a permission-filtered route back to the main dashboard and the full menu', () => {
        expect(layoutSource).toContain(
            "{ to: '/dashboard', icon: LayoutDashboard, label: 'Inicio', roles: ALL_ROLES }",
        );
        expect(layoutSource).toContain('hasPermission(user, item.permission, item.roles)');
        expect(layoutSource).toContain('aria-label="Más opciones"');
        expect(layoutSource).toContain('<span>Más</span>');
    });

    it('uses bottom navigation through tablet widths and preserves desktop workspaces', () => {
        expect(layoutStyles).toContain('@media (min-width: 1025px)');
        expect(layoutStyles.match(/@media \(max-width: 1024px\)/g)).toHaveLength(3);
        expect(layoutStyles).toContain('.workspace-layout .sidebar {');
        expect(layoutStyles).not.toContain(
            '.workspace-layout .sidebar,\n.workspace-layout .mobile-bottom-nav',
        );
        expect(layoutStyles).toContain(
            'padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));',
        );
        expect(layoutStyles).toContain('box-sizing: border-box;');
    });

    it('keeps the responsive navigation fixed and safe-area aware', () => {
        expect(layoutStyles).toContain('.mobile-bottom-nav {');
        expect(layoutStyles).toContain('position: fixed;');
        expect(layoutStyles).toContain(
            'padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));',
        );
        expect(layoutStyles).toContain('.mobile-menu-drawer {');
    });
});
