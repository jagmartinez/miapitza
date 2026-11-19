import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8');

describe('purchase suggestion and unit-cost precision contract', () => {
    const inventory = read('Inventory.tsx');
    const purchaseOrders = read('PurchaseOrders.tsx');
    const purchaseOrderForm = read('PurchaseOrderForm.tsx');
    const menu = read('Menu.tsx');

    it('never rounds the suggested unit cost to cents before creating the PO', () => {
        for (const source of [inventory, purchaseOrders]) {
            expect(source).toContain('selectedSuggestions.map(toAutoPurchaseLine)');
            expect(source).toContain('unit: suggestion.purchaseUnit');
            expect(source).not.toMatch(/estimatedCost[^\n]*\/ suggestion\.suggestedQuantity\)\.toFixed\(2\)/);
        }
    });

    it('lets per-base-unit costs below one cent be entered and displayed', () => {
        expect(inventory).toMatch(/id="inventory-reference-cost"\s+type="number"\s+step="any"/);
        expect(inventory).toContain('maximumFractionDigits: 6');
        expect(purchaseOrderForm).toContain('formatPurchaseUnitCost(Number(item.cost))');
    });

    it('flags menu items without recipe', () => {
        expect(menu).toContain('missingRecipe');
        expect(menu).toContain('Sin receta');
    });
});
