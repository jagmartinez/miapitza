import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('inventory data loading integrity contract', () => {
    const inventorySource = fs.readFileSync(path.resolve(__dirname, 'Inventory.tsx'), 'utf8');

    it('surfaces partial load failures and offers a retry', () => {
        expect(inventorySource).toContain('Promise.allSettled');
        expect(inventorySource).toContain('Inventario cargado parcialmente');
        expect(inventorySource).toContain('role="alert"');
        expect(inventorySource).toContain('Reintentar cargas');
    });

    it('does not hide the low stock data when its request fails', () => {
        // LowStockAlert (orphan widget) was removed by the UI migration; its stock-bajo
        // failure handling now lives in the Inventory load-issues banner with retry.
        expect(inventorySource).toContain("setLoadIssue('Stock bajo', lowStockRes.reason)");
        expect(inventorySource).toContain('Los datos faltantes no se mostraran como cero ni como listas vacias.');
        expect(inventorySource).toContain('void loadInventory();');
    });
});
