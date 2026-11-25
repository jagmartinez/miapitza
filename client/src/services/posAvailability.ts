import api from './api';

export type MenuAvailabilityStatus = 'OK' | 'LOW' | 'OUT';

export interface MenuAvailabilityItem {
    menuItemId: number;
    status: MenuAvailabilityStatus;
    /** Porciones completas que alcanzan con las existencias de la bodega. */
    portions: number;
}

export interface MenuAvailability {
    warehouseId: number;
    items: MenuAvailabilityItem[];
}

export const MENU_AVAILABILITY_URL = '/v1/pos/menu-availability';

/** Solo lectura; el servidor monta la ruta en /api/v1/pos (api.ts antepone /api). */
export const posAvailabilityAPI = {
    getMenuAvailability: (warehouseId: number) =>
        api.get<{ success: boolean; data: MenuAvailability }>(MENU_AVAILABILITY_URL, { params: { warehouseId } }),
};

/** Mapa plato -> estado. Cualquier fallo devuelve null: el POS no muestra aviso en vez de inventarlo. */
export async function loadMenuAvailability(warehouseId: number): Promise<Map<number, MenuAvailabilityItem> | null> {
    try {
        const response = await posAvailabilityAPI.getMenuAvailability(warehouseId);
        const items = response.data?.data?.items;
        if (!Array.isArray(items)) return null;
        return new Map(items.map((item) => [item.menuItemId, item]));
    } catch {
        return null;
    }
}
