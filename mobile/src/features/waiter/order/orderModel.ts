import { formatCurrency } from '@web/utils/currency';
import { isCategoryVisibleInMenu } from '@web/utils/categoryVisibility';

/** Loosely typed server payloads; this file narrows what the order screen uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** "C$ 640" (whole amounts drop the cents). */
export const money = (amount: unknown) => formatCurrency(amount).replace(/\.00$/, '');

export interface Product {
    id: number;
    name: string;
    price: number;
    categoryId: number | null;
    /** `_count.modifierGroups`: the list does not embed the groups themselves. */
    modifierGroups: number;
}

export function normalizeProducts(menu: unknown): Product[] {
    if (!Array.isArray(menu)) return [];
    return menu
        .filter((m: Json) => m && typeof m.id === 'number' && m.active !== false)
        .map((m: Json) => ({
            id: m.id,
            name: String(m.name ?? ''),
            price: Number(m.price) || 0,
            categoryId: typeof m.categoryId === 'number' ? m.categoryId : (m.category?.id ?? null),
            modifierGroups: Number(m._count?.modifierGroups) || 0,
        }));
}

export interface ModifierOption {
    id: number;
    name: string;
    price: number;
}
export interface ModifierGroup {
    id: number;
    name: string;
    minSelect: number;
    /** null = no upper bound. */
    maxSelect: number | null;
    modifiers: ModifierOption[];
}

/** GET /menu-items/:id -> the groups with their active modifiers. */
export function normalizeModifierGroups(item: unknown): ModifierGroup[] {
    const groups = (item as Json | null)?.modifierGroups;
    if (!Array.isArray(groups)) return [];
    return groups
        .filter((g: Json) => g && g.active !== false)
        .map((g: Json) => ({
            id: g.id,
            name: String(g.name ?? ''),
            minSelect: Number(g.minSelect) || 0,
            maxSelect: g.maxSelect == null ? null : Number(g.maxSelect),
            modifiers: (Array.isArray(g.modifiers) ? g.modifiers : [])
                .filter((m: Json) => m && m.active !== false)
                .map((m: Json) => ({ id: m.id, name: String(m.name ?? ''), price: Number(m.price) || 0 })),
        }));
}

export interface RailEntry {
    id: 'top' | 'promos' | number;
    name: string;
}

/** Top, Promos (when there is something to show), then the categories visible in the menu that have products. */
export function buildRail(opts: { categories: unknown; products: Product[]; topIds: number[]; promoIds: Set<number> }): RailEntry[] {
    const rail: RailEntry[] = [];
    const known = new Set(opts.products.map((p) => p.id));
    if (opts.topIds.some((id) => known.has(id))) rail.push({ id: 'top', name: 'Top' });
    if (opts.products.some((p) => opts.promoIds.has(p.id))) rail.push({ id: 'promos', name: 'Promos' });
    const used = new Set(opts.products.map((p) => p.categoryId));
    const cats = (Array.isArray(opts.categories) ? opts.categories : []) as Json[];
    cats
        .filter((c) => c && typeof c.id === 'number' && isCategoryVisibleInMenu(c) && used.has(c.id))
        .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.name).localeCompare(String(b.name)))
        .forEach((c) => rail.push({ id: c.id, name: String(c.name) }));
    return rail;
}

export function productsFor(entry: RailEntry['id'], products: Product[], topIds: number[], promoIds: Set<number>): Product[] {
    if (entry === 'top') {
        const byId = new Map(products.map((p) => [p.id, p]));
        return topIds.map((id) => byId.get(id)).filter((p): p is Product => !!p);
    }
    if (entry === 'promos') return products.filter((p) => promoIds.has(p.id));
    return products.filter((p) => p.categoryId === entry);
}

function promoBadge(promo: Json): string | null {
    switch (promo.type) {
        case 'BUY_X_GET_Y':
            return promo.buyQuantity && promo.payQuantity ? `${promo.buyQuantity}x${promo.payQuantity}` : null;
        case 'COMBO':
            return 'Combo';
        case 'PERCENTAGE':
            return promo.scope === 'ITEMS' ? `−${Number(promo.value)} %` : null;
        case 'FIXED_AMOUNT':
            return promo.scope === 'ITEMS' ? `−${money(promo.value)}` : null;
        default:
            return null;
    }
}

/** One short badge per product with an item-scoped promotion in force (2x1, Combo, -20 %). */
export function promoLabels(promotions: unknown, products: Product[]): Map<number, string> {
    const labels = new Map<number, string>();
    if (!Array.isArray(promotions)) return labels;
    for (const promo of promotions as Json[]) {
        if (!promo || promo.scheduleActiveNow === false || promo.active === false) continue;
        const label = promoBadge(promo);
        if (!label) continue;
        const targetItems = new Set<number>(promo.targetMenuItemIds ?? []);
        const targetCategories = new Set<number>(promo.targetCategoryIds ?? []);
        const comboItems = new Set<number>((promo.comboItems ?? []).map((c: Json) => c.menuItemId));
        for (const product of products) {
            const hit =
                promo.type === 'COMBO'
                    ? comboItems.has(product.id)
                    : promo.scope === 'ITEMS' && (targetItems.has(product.id) || (product.categoryId != null && targetCategories.has(product.categoryId)));
            if (hit && !labels.has(product.id)) labels.set(product.id, label);
        }
    }
    return labels;
}

/** Where a line of the order is, from the server's point of view. */
export type LineState = 'new' | 'preparing' | 'ready' | 'delivered';

export interface ServerLine {
    id: number;
    menuItemId: number;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    notes: string;
    modifiers: string[];
    state: LineState;
    /** When the kitchen finished it (drives "hace X min"). */
    finishedAt: string | null;
}

export function lineState(item: Json): LineState {
    if (!item.sentAt) return 'new';
    if (item.status === 'DONE') return item.deliveredAt ? 'delivered' : 'ready';
    return 'preparing';
}

/** Order payload (GET /orders/:id or an /orders/active row) -> live lines. Voided lines (quantity 0) never show. */
export function normalizeServerLines(order: unknown): ServerLine[] {
    const items = (order as Json | null)?.items;
    if (!Array.isArray(items)) return [];
    return items
        .filter((i: Json) => i && typeof i.id === 'number' && !i.voidedAt && Number(i.quantity) > 0)
        .map((i: Json) => ({
            id: i.id,
            menuItemId: i.menuItemId,
            name: String(i.menuItem?.name ?? i.name ?? 'Producto'),
            quantity: Number(i.quantity),
            unitPrice: Number(i.price) || 0,
            subtotal: Number(i.subtotal) || (Number(i.price) || 0) * Number(i.quantity),
            notes: String(i.notes ?? ''),
            modifiers: (Array.isArray(i.modifiers) ? i.modifiers : []).map((m: Json) => String(m.modifier?.name ?? m.name ?? '')).filter(Boolean),
            state: lineState(i),
            finishedAt: i.finishedAt ?? null,
        }));
}

export function minutesSince(iso: string | null | undefined, now: number): number {
    if (!iso) return 0;
    return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** "hace 3 min" / "ahora". */
export function agoLabel(iso: string | null | undefined, now: number): string {
    if (!iso) return '';
    const minutes = minutesSince(iso, now);
    return minutes < 1 ? 'ahora' : `hace ${minutes} min`;
}

export const sumQuantity = (lines: { quantity: number }[]) => lines.reduce((n, l) => n + l.quantity, 0);
