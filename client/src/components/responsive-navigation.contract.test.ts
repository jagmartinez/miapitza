import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const navSource = readFileSync(new URL('./MobileBottomNav.tsx', import.meta.url), 'utf8');
const navConfigSource = readFileSync(new URL('../navigation/navConfig.ts', import.meta.url), 'utf8');
const navStyles = readFileSync(new URL('./MobileBottomNav.css', import.meta.url), 'utf8');

describe('responsive global navigation contract', () => {
    it('keeps a permission-filtered route back to the main dashboard and the full menu', () => {
        expect(navConfigSource).toContain(
            "{ id: 'dashboard', to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES }",
        );
        expect(navConfigSource).toContain('hasPermission(user, item.permission');
        expect(layoutSource).toContain('<MobileBottomNav nav={nav}');
        expect(navSource).toContain("dashboard: 'Inicio'");
        expect(navSource).toContain('aria-label="Más opciones"');
        expect(navSource).toContain('<span>Más</span>');
    });

    it('uses bottom navigation through tablet widths and preserves desktop workspaces', () => {
        expect(navStyles).toContain('@media (max-width: 1024px)');
        expect(navStyles).toContain('.ui-shell__rail { display: none; }');
        expect(navStyles).toContain(
            'padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));',
        );
        expect(navStyles).toContain('box-sizing: border-box;');
    });

    it('keeps the responsive navigation fixed and safe-area aware', () => {
        expect(navStyles).toContain('.mobile-bottom-nav {');
        expect(navStyles).toContain('position: fixed;');
        expect(navStyles).toContain(
            'padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));',
        );
        expect(navSource).toContain('<Drawer isOpen={open}');
    });
});
