/** Per-branch ingredient -> warehouse routing rule being edited. */
export type WarehouseRouteDraft = {
    key: string;
    kind: 'CATEGORY' | 'PRODUCT';
    targetId: number | null;
    warehouseId: number | null;
};

/** Converts drafts into the API payload; returns an error message when incomplete or duplicated. */
export function buildWarehouseRoutesPayload(drafts: WarehouseRouteDraft[]):
    { routes: Array<{ warehouseId: number; categoryId?: number; productId?: number }> } | { error: string } {
    const seen = new Set<string>();
    const routes: Array<{ warehouseId: number; categoryId?: number; productId?: number }> = [];
    for (const draft of drafts) {
        if (!draft.targetId || !draft.warehouseId) {
            return { error: 'Complete el producto/categoría y la bodega de cada regla' };
        }
        const key = `${draft.kind}:${draft.targetId}`;
        if (seen.has(key)) {
            return { error: draft.kind === 'PRODUCT' ? 'Hay un producto repetido en las reglas' : 'Hay una categoría repetida en las reglas' };
        }
        seen.add(key);
        routes.push(draft.kind === 'PRODUCT'
            ? { warehouseId: draft.warehouseId, productId: draft.targetId }
            : { warehouseId: draft.warehouseId, categoryId: draft.targetId });
    }
    return { routes };
}
