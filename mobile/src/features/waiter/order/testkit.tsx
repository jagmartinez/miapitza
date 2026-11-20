import type { Session } from '../../../core/session';
import { MobileDB } from '../../../data/cache';
import { createDrafts } from '../../../data/drafts';
import { session as baseSession } from '../../../test/helpers';
import { makeRealtime } from '../tables/testkit';
import type { OrderApi } from './OrderScreen';

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const result = <T,>(data: T) => ({ data, source: 'network' as const, refresh: Promise.resolve() });

export const ALL_PERMISSIONS = ['orders.view', 'orders.create', 'orders.edit', 'orders.deliver', 'payments.process', 'bills.split', 'orders.discount.apply'];

export function userSession(permissions: string[] = ALL_PERMISSIONS, id = 7): Session {
    return { ...baseSession, user: { ...baseSession.user, id, permissions } };
}

export const menu = [
    { id: 1, name: 'Pizza Margarita', price: '100.00', active: true, categoryId: 10, _count: { modifierGroups: 0 } },
    { id: 2, name: 'Cola', price: '30.00', active: true, categoryId: 11, _count: { modifierGroups: 0 } },
    { id: 3, name: 'Hamburguesa', price: '120.00', active: true, categoryId: 10, _count: { modifierGroups: 1 } },
    { id: 4, name: 'Ensalada', price: '80.00', active: true, categoryId: 12, _count: { modifierGroups: 0 } },
];

export const categories = [
    { id: 11, name: 'Bebidas', sortOrder: 2, active: true, showInMenu: true },
    { id: 10, name: 'Platos', sortOrder: 1, active: true, showInMenu: true },
    { id: 12, name: 'Oculta', sortOrder: 3, active: true, showInMenu: false },
];

export const burgerDetail = {
    id: 3,
    name: 'Hamburguesa',
    modifierGroups: [
        {
            id: 1,
            name: 'Punto',
            minSelect: 1,
            maxSelect: 1,
            active: true,
            modifiers: [
                { id: 31, name: 'Término medio', price: '0.00', active: true },
                { id: 32, name: 'Bien cocida', price: '10.00', active: true },
            ],
        },
    ],
};

export const promotions = [{ id: 1, type: 'BUY_X_GET_Y', scope: 'ITEMS', buyQuantity: 2, payQuantity: 1, targetMenuItemIds: [2], scheduleActiveNow: true, active: true }];

export type Line = Record<string, unknown>;
export function serverItem(id: number, menuItemId: number, name: string, over: Line = {}): Line {
    return { id, menuItemId, quantity: 1, price: '50.00', subtotal: '50.00', notes: null, status: 'PENDING', sentAt: minutesAgo(10), deliveredAt: null, finishedAt: null, menuItem: { id: menuItemId, name }, modifiers: [], ...over };
}

export function orderOf(items: Line[], over: Line = {}) {
    return { id: 102, tableId: 2, table: { id: 2, number: '2' }, guests: 3, status: 'OPEN', total: '0.00', createdAt: minutesAgo(25), user: { id: 7, name: 'Ana Perez' }, items, payments: [], ...over };
}

export function makeApi(over: Partial<Record<keyof OrderApi, unknown>> = {}) {
    return {
        menu: vi.fn().mockResolvedValue(result(menu)),
        menuItem: vi.fn().mockImplementation(async (id: number) => result(id === 3 ? burgerDetail : { id, modifierGroups: [] })),
        categories: vi.fn().mockResolvedValue(result(categories)),
        topSellers: vi.fn().mockResolvedValue(result([{ menuItemId: 3, quantity: 40 }, { menuItemId: 1, quantity: 30 }])),
        promotions: vi.fn().mockResolvedValue(result(promotions)),
        orderDetail: vi.fn().mockResolvedValue(orderOf([])),
        activeOrders: vi.fn().mockResolvedValue(result([])),
        addItem: vi.fn().mockResolvedValue({ id: 1 }),
        sendToKitchen: vi.fn().mockResolvedValue({ kitchenBatchSent: true }),
        createOrder: vi.fn().mockResolvedValue({ id: 900 }),
        updateItem: vi.fn().mockResolvedValue({}),
        removeItem: vi.fn().mockResolvedValue({}),
        deliverItems: vi.fn().mockResolvedValue({ delivered: [], skipped: [], alreadyDelivered: [] }),
        pricing: vi.fn().mockResolvedValue({}),
        authorizeDiscount: vi.fn().mockResolvedValue({}),
        supervisors: vi.fn().mockResolvedValue([{ id: 31, name: 'Marta Lopez', initials: 'ML', color: null }, { id: 32, name: 'Raul Diaz', initials: 'RD', color: null }]),
        discountLimit: vi.fn().mockResolvedValue({ limitPercent: 10 }),
        validateCoupon: vi.fn().mockResolvedValue({ valid: true, discount: 20, message: 'Cupón aplicado' }),
        ...over,
    } as unknown as { [K in keyof OrderApi]: OrderApi[K] & ReturnType<typeof vi.fn> };
}

let n = 0;
export function makeDrafts() {
    return createDrafts(new MobileDB(`order-${++n}-${Date.now()}`));
}

export { makeRealtime };
