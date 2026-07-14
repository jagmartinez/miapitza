export interface CategorizedMenuItem {
    categoryId: number;
    category?: { id: number; name: string } | null;
}

export function getMenuCategoryOptions(items: CategorizedMenuItem[]) {
    const categories = new Map<number, string>();
    items.forEach((item) => {
        const id = item.category?.id ?? item.categoryId;
        if (id) categories.set(id, item.category?.name?.trim() || `Categoría #${id}`);
    });
    return [...categories.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'es'))
        .map(([id, name]) => ({ value: String(id), label: name }));
}

export function filterMenuItemsByCategory<T extends CategorizedMenuItem>(items: T[], categoryId: string): T[] {
    if (!categoryId || categoryId === 'all') return items;
    return items.filter((item) => String(item.category?.id ?? item.categoryId) === categoryId);
}
