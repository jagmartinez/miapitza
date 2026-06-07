export function getCategoryVisibilityLabel(showInMenu: boolean, showInInventory: boolean): string {
    if (showInMenu && showInInventory) return 'Menú + Inventario';
    if (showInMenu) return 'Solo menú';
    if (showInInventory) return 'Solo inventario';
    return 'Sin visibilidad';
}

export function isCategoryVisibleInMenu(cat: { active?: boolean; showInMenu?: boolean }): boolean {
    return cat.active !== false && cat.showInMenu !== false;
}

export function isCategoryVisibleInInventory(cat: { active?: boolean; showInInventory?: boolean }): boolean {
    return cat.active !== false && cat.showInInventory !== false;
}
