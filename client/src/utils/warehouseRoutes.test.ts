import { describe, expect, it } from 'vitest';
import { buildWarehouseRoutesPayload } from './warehouseRoutes';

describe('buildWarehouseRoutesPayload', () => {
    it('maps category and product rules to the API payload', () => {
        expect(buildWarehouseRoutesPayload([
            { key: 'a', kind: 'CATEGORY', targetId: 10, warehouseId: 2 },
            { key: 'b', kind: 'PRODUCT', targetId: 8, warehouseId: 1 },
        ])).toEqual({ routes: [{ warehouseId: 2, categoryId: 10 }, { warehouseId: 1, productId: 8 }] });
    });

    it('rejects incomplete and duplicated rules', () => {
        expect(buildWarehouseRoutesPayload([{ key: 'a', kind: 'CATEGORY', targetId: null, warehouseId: 2 }]))
            .toEqual({ error: expect.stringMatching(/Complete/) });
        expect(buildWarehouseRoutesPayload([
            { key: 'a', kind: 'PRODUCT', targetId: 8, warehouseId: 2 },
            { key: 'b', kind: 'PRODUCT', targetId: 8, warehouseId: 1 },
        ])).toEqual({ error: expect.stringMatching(/repetido/) });
    });

    it('an empty rule set clears every route', () => {
        expect(buildWarehouseRoutesPayload([])).toEqual({ routes: [] });
    });
});
