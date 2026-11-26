import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../navigation/navConfig.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8');
const inventory = readFileSync(new URL('../pages/Inventory.tsx', import.meta.url), 'utf8');

describe('inventory count review wiring', () => {
    it('lazy-loads /inventario/conteos behind the ADMIN role guard', () => {
        expect(app).toContain("lazy(() => import('./pages/inventory-count/InventoryCountReview'))");
        expect(app).toMatch(/path="\/inventario\/conteos" element=\{<RoleGuard roles=\{ADMIN\}>/);
    });

    it('adds the nav item for admins next to Inventario', () => {
        expect(layout).toMatch(/to: '\/inventario\/conteos'[^\n]*label: 'Conteos de inventario', roles: ADMIN/);
        expect(layout).toContain('hasPermission(user, item.permission');
    });

    it('calls the review endpoints and sends the idempotency key on approve', () => {
        expect(api).toContain("'/v1/inventory-counts'");
        expect(api).toMatch(/approve: \(id: number, idempotencyKey: string\)[\s\S]*idempotencyHeaders\(idempotencyKey\)/);
    });

    it('physical count screen explains COUNT_SHEET_OPEN in Spanish', () => {
        expect(inventory).toContain("'COUNT_SHEET_OPEN'");
        expect(inventory).toContain('Hay un conteo abierto en esta bodega; apruébalo o recházalo primero');
    });
});
