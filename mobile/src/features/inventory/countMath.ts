import type { CountCategory, CountLine } from './inventoryTypes';

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'clear';

const MAX_DECIMALS = 3;
const MAX_INTEGER_DIGITS = 9;

/** One press of the decimal keypad: a single dot (a leading one becomes "0."), at most 3 decimals, no stray leading zeros. */
export function applyKey(text: string, key: Key): string {
    if (key === 'clear') return '';
    if (key === 'back') return text.slice(0, -1);
    if (key === '.') {
        if (text.includes('.')) return text;
        return text === '' ? '0.' : `${text}.`;
    }
    const dot = text.indexOf('.');
    if (dot >= 0) return text.length - dot - 1 >= MAX_DECIMALS ? text : text + key;
    if (text === '0') return key;
    return text.length >= MAX_INTEGER_DIGITS ? text : text + key;
}

/** The typed quantity as a number, or null while nothing usable is typed. */
export function parseQty(text: string): number | null {
    if (text === '' || text === '.') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

type ProgressLine = Pick<CountLine, 'categoryId' | 'counted'>;

/** Counted / total of one category, or of the whole sheet when `categoryId` is undefined. */
export function progress(lines: ProgressLine[], categoryId?: number | null): { counted: number; total: number } {
    const scope = categoryId === undefined ? lines : lines.filter((l) => l.categoryId === categoryId);
    return { counted: scope.filter((l) => l.counted).length, total: scope.length };
}

/** Lines grouped by the sheet's category order (the order the counter walks them in). */
export function orderLines(categories: CountCategory[], lines: CountLine[]): CountLine[] {
    const known = new Set(categories.map((c) => c.categoryId));
    return [...categories.flatMap((c) => lines.filter((l) => l.categoryId === c.categoryId)), ...lines.filter((l) => !known.has(l.categoryId))];
}

/** The next uncounted product after the current one in its category, then the first uncounted of each following category; null when none is left. */
export function nextLine(lines: Array<Pick<CountLine, 'productId' | 'categoryId' | 'counted'>>, currentProductId: number, categoryId: number | null): number | null {
    const inCategory = lines.filter((l) => l.categoryId === categoryId);
    const after = inCategory.slice(inCategory.findIndex((l) => l.productId === currentProductId) + 1).find((l) => !l.counted);
    if (after) return after.productId;
    const categories: Array<number | null> = [];
    for (const l of lines) if (!categories.includes(l.categoryId)) categories.push(l.categoryId);
    for (const c of categories.slice(categories.indexOf(categoryId) + 1)) {
        const first = lines.find((l) => l.categoryId === c && !l.counted);
        if (first) return first.productId;
    }
    return null;
}
