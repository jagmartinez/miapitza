import { formatLocalDateInput } from './dateInput';

/** Kardex filters carried in the URL by other screens (e.g. an approved inventory count's movement). */
export interface KardexUrlFilters {
    productId: number | null;
    warehouseId: number | null;
    dateFrom: string | null;
}

/** Link that opens the Kardex on one product in one warehouse, starting on the given day (local date). */
export function kardexHref({ productId, warehouseId, from }: { productId: number; warehouseId: number; from: Date | null }): string {
    const params = new URLSearchParams({ productId: String(productId), warehouseId: String(warehouseId) });
    if (from && !Number.isNaN(from.getTime())) params.set('dateFrom', formatLocalDateInput(from));
    return `/kardex?${params.toString()}`;
}

const positiveInt = (value: string | null): number | null => (value !== null && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null);

export function kardexUrlFilters(search: string): KardexUrlFilters {
    const params = new URLSearchParams(search);
    const dateFrom = params.get('dateFrom');
    return {
        productId: positiveInt(params.get('productId')),
        warehouseId: positiveInt(params.get('warehouseId')),
        dateFrom: dateFrom !== null && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : null,
    };
}
