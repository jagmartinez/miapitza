import { describe, expect, it } from 'vitest';
import type { Warehouse } from '../types';
import { preferredSaleWarehouseId } from './saleWarehouse';

const branch = (defaultSaleWarehouseId: number | null) => ({
    id: 2, companyId: 1, name: 'Centro', code: 'C', status: 'ACTIVE', defaultSaleWarehouseId
});
const wh = (id: number, defaultSaleWarehouseId: number | null): Warehouse => ({
    id, name: `B${id}`, code: `B${id}`, type: 'BRANCH', branchId: 2, branch: branch(defaultSaleWarehouseId)
});

describe('preferredSaleWarehouseId', () => {
    it('prefers the branch default sale warehouse among several', () => {
        expect(preferredSaleWarehouseId([wh(5, 6), wh(6, 6)])).toBe(6);
    });
    it('falls back to the single warehouse, else no preselection', () => {
        expect(preferredSaleWarehouseId([wh(5, null)])).toBe(5);
        expect(preferredSaleWarehouseId([wh(5, null), wh(6, null)])).toBeNull();
        expect(preferredSaleWarehouseId([wh(5, 99), wh(6, 99)])).toBeNull();
        expect(preferredSaleWarehouseId([])).toBeNull();
    });
});
