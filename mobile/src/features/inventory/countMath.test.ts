import { applyKey, nextLine, parseQty, progress, type Key } from './countMath';

const type = (keys: Key[], from = '') => keys.reduce((t, k) => applyKey(t, k), from);

describe('countMath', () => {
    it('decimal keypad rejects second dot and fourth decimal', () => {
        expect(type(['1', '.', '5', '.', '2'])).toBe('1.52');
        expect(type(['1', '.', '1', '2', '3', '4'])).toBe('1.123');
        expect(type(['0', '0', '5'])).toBe('5');
        expect(type(['9', '9', '9', '9', '9', '9', '9', '9', '9', '9'])).toBe('999999999');
        expect(type(['1', '2', 'back'])).toBe('1');
        expect(type(['1', '2', 'clear'])).toBe('');
    });

    it('leading dot becomes 0.', () => {
        expect(applyKey('', '.')).toBe('0.');
        expect(parseQty('0.')).toBe(0);
        expect(parseQty('')).toBeNull();
        expect(parseQty('2.5')).toBe(2.5);
    });

    it('nextLine skips counted and moves to next category', () => {
        const l = (productId: number, categoryId: number | null, counted: boolean) => ({ productId, categoryId, counted });
        const lines = [l(1, 10, true), l(2, 10, false), l(3, 10, true), l(4, 20, true), l(5, 20, false), l(6, null, false)];
        expect(nextLine(lines, 1, 10)).toBe(2);
        expect(nextLine(lines, 2, 10)).toBe(5);
        expect(nextLine(lines, 5, 20)).toBe(6);
        expect(nextLine(lines, 6, null)).toBeNull();
    });

    it('progress per category and overall', () => {
        const lines = [
            { categoryId: 10, counted: true },
            { categoryId: 10, counted: false },
            { categoryId: null, counted: true },
        ];
        expect(progress(lines, 10)).toEqual({ counted: 1, total: 2 });
        expect(progress(lines, null)).toEqual({ counted: 1, total: 1 });
        expect(progress(lines)).toEqual({ counted: 2, total: 3 });
    });
});

describe('plural', () => {
    it('uses the singular only for exactly one', async () => {
        const { plural } = await import('./inventoryFormat');
        expect(plural(1, 'producto', 'productos')).toBe('1 producto');
        expect(plural(0, 'producto', 'productos')).toBe('0 productos');
        expect(plural(3, 'categoría', 'categorías')).toBe('3 categorías');
    });
});
