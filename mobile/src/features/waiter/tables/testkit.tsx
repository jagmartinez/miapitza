import type { Session } from '../../../core/session';
import { session as baseSession } from '../../../test/helpers';
import type { TablesApi } from './TablesScreen';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const branch = { id: 1, name: 'Sucursal Centro', code: 'C' };

const tableBase = { branchId: 1, capacity: 4, status: 'AVAILABLE', mapWidth: 160, mapHeight: 120, mapShape: 'RECTANGLE', mapRotation: 0, activeTableGroupId: null, activeTableGroup: null, branch };

export const planData = {
    id: 1,
    branchId: 1,
    canvasWidth: 1600,
    canvasHeight: 1000,
    version: 1,
    areas: [
        { id: 1, name: 'Salón', kind: 'DINING' },
        { id: 2, name: 'Terraza', kind: 'TERRACE' },
    ],
    tables: [
        { ...tableBase, id: 1, number: '1', floorAreaId: 1, mapX: 40, mapY: 40, operationalState: 'AVAILABLE' },
        { ...tableBase, id: 2, number: '2', floorAreaId: 1, mapX: 240, mapY: 40, operationalState: 'OPEN_ORDER', status: 'OCCUPIED' },
        { ...tableBase, id: 3, number: '3', floorAreaId: 1, mapX: 440, mapY: 40, operationalState: 'READY', status: 'OCCUPIED' },
        { ...tableBase, id: 4, number: '4', floorAreaId: 1, mapX: 640, mapY: 40, operationalState: 'INVOICED', status: 'OCCUPIED' },
        { ...tableBase, id: 7, number: '7', floorAreaId: 1, mapX: 840, mapY: 40, operationalState: 'RESERVED', status: 'RESERVED' },
        { ...tableBase, id: 5, number: '5', floorAreaId: 2, mapX: 40, mapY: 240, operationalState: 'AVAILABLE' },
        { ...tableBase, id: 6, number: '6', floorAreaId: 2, mapX: 240, mapY: 240, operationalState: 'PREPARING', status: 'OCCUPIED' },
    ],
};

export const activeOrders = [
    { id: 102, tableId: 2, status: 'OPEN', total: '350.00', guests: 3, createdAt: minutesAgo(25), user: { id: 7, name: 'Ana Perez' }, items: [{ quantity: 2, sentAt: null, status: 'PENDING' }, { quantity: 1, sentAt: minutesAgo(10), status: 'IN_PROGRESS' }] },
    { id: 103, tableId: 3, status: 'READY', total: '120.00', guests: 2, createdAt: minutesAgo(40), user: { id: 9, name: 'Luis Gomez Hernandez De La Cruz Muy Largo' }, items: [] },
    { id: 104, tableId: 4, status: 'READY', total: '500.00', guests: 4, createdAt: minutesAgo(70), user: { id: 7, name: 'Ana Perez' }, items: [] },
    { id: 106, tableId: 6, status: 'IN_PREPARATION', total: '80.00', guests: 1, createdAt: minutesAgo(5), user: { id: 9, name: 'Luis Gomez' }, items: [] },
];

export const result = <T,>(data: T) => ({ data, source: 'network' as const, refresh: Promise.resolve() });

export function userSession(permissions: string[] = []): Session {
    return { ...baseSession, user: { ...baseSession.user, permissions } };
}

export type FakeTablesApi = { [K in keyof TablesApi]: TablesApi[K] & ReturnType<typeof vi.fn> };

export function makeApi(over: Partial<TablesApi> = {}): FakeTablesApi {
    return {
        floorPlan: vi.fn().mockResolvedValue(result(planData)),
        activeOrders: vi.fn().mockResolvedValue(result(activeOrders)),
        createOrder: vi.fn().mockResolvedValue({ id: 555 }),
        transfer: vi.fn().mockResolvedValue({ mode: 'FULL' }),
        groupTables: vi.fn().mockResolvedValue({ id: 1 }),
        // GET /orders/:id returns every payment, whatever its status.
        orderDetail: vi.fn().mockImplementation(async (id: number) => ({ id, payments: id === 104 ? [{ amount: '100.00', status: 'ACTIVE' }, { amount: '50.00', status: 'REVERSED' }] : [] })),
        ...over,
    } as unknown as FakeTablesApi;
}

/** Realtime stub that lets a test fire events at the subscribed handlers. */
export function makeRealtime() {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    return {
        subscribe: vi.fn((type: string, fn: (payload: unknown) => void) => {
            const set = handlers.get(type) ?? new Set();
            set.add(fn);
            handlers.set(type, set);
            return () => set.delete(fn);
        }),
        emit(type: string, payload?: unknown) {
            for (const fn of handlers.get(type) ?? []) fn(payload);
        },
    };
}
