import { describe, expect, it } from 'vitest';
import { filterMenuItemsByCategory, getMenuCategoryOptions } from './cateringMenuFilter';

const items = [
    { id: 1, categoryId: 2, category: { id: 2, name: 'Bebidas' } },
    { id: 2, categoryId: 1, category: { id: 1, name: 'Entradas' } },
    { id: 3, categoryId: 2, category: { id: 2, name: 'Bebidas' } },
];

describe('catering menu category filter', () => {
    it('builds unique, alphabetically ordered categories', () => {
        expect(getMenuCategoryOptions(items)).toEqual([
            { value: '2', label: 'Bebidas' },
            { value: '1', label: 'Entradas' },
        ]);
    });

    it('filters by category and preserves all items for the all option', () => {
        expect(filterMenuItemsByCategory(items, '2').map((item) => item.id)).toEqual([1, 3]);
        expect(filterMenuItemsByCategory(items, 'all')).toHaveLength(3);
    });
});
