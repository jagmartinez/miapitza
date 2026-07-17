import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('inventory data loading integrity contract', () => {
    const inventorySource = fs.readFileSync(path.resolve(__dirname, 'Inventory.tsx'), 'utf8');
    const lowStockSource = fs.readFileSync(path.resolve(__dirname, '../components/LowStockAlert.tsx'), 'utf8');

    it('surfaces partial load failures and offers a retry', () => {
        expect(inventorySource).toContain('Promise.allSettled');
        expect(inventorySource).toContain('Inventario cargado parcialmente');
        expect(inventorySource).toContain('role="alert"');
        expect(inventorySource).toContain('Reintentar cargas');
    });

    it('does not hide the low stock widget when its request fails', () => {
        expect(lowStockSource).toContain('Alertas de inventario no disponibles');
        expect(lowStockSource).toContain('No se puede afirmar que no haya stock bajo');
        expect(lowStockSource).toContain('onClick={() => void loadLowStock()}');
    });
});
