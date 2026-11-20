/** Loosely typed floor plan / order payloads (GET /tables/plan/:branchId, GET /orders/active). */
export interface PlanTable {
    id: number;
    number: string;
    capacity: number;
    status?: string;
    operationalState?: string;
    floorAreaId?: number | null;
    mapX: number;
    mapY: number;
    mapWidth: number;
    mapHeight: number;
    mapShape?: string;
    activeTableGroupId?: number | null;
    activeTableGroup?: { id: number; primaryTableId: number; memberTableIds?: number[] } | null;
    branch?: { id: number; name: string } | null;
}
export interface PlanArea {
    id: number;
    name: string;
}
export interface Plan {
    canvasWidth: number;
    canvasHeight: number;
    areas: PlanArea[];
    tables: PlanTable[];
}
export interface ActiveOrder {
    id: number;
    tableId?: number | null;
    table?: { id: number } | null;
    status?: string;
    total?: number | string;
    guests?: number | null;
    createdAt?: string;
    user?: { id: number; name: string } | null;
    items?: { quantity: number; sentAt?: string | null; status?: string; voidedQuantity?: number }[];
    payments?: { amount: number | string }[];
}

/** The four border states of a table on the floor plan. */
export type TableState = 'free' | 'occupied' | 'ready' | 'due';

/** Operational state of the plan -> border state. Reserved/disabled tables read as free (server rejects opening them). */
export function tableState(
    table: { operationalState?: string; status?: string },
    order?: { status?: string } | undefined,
): TableState {
    switch (table.operationalState) {
        case 'READY':
        case 'PARTIALLY_READY':
            return 'ready';
        case 'INVOICED':
        case 'PARTIAL_PAYMENT':
            return 'due';
        case 'OPEN_ORDER':
        case 'WAITING_KITCHEN':
        case 'PREPARING':
        case 'ATTENTION':
        case 'JOINED':
            return 'occupied';
        case 'AVAILABLE':
        case 'PAID':
        case 'RESERVED':
        case 'DISABLED':
            return 'free';
    }
    // Older payloads without operationalState: derive from the table status and its order.
    if (order?.status === 'READY') return 'ready';
    if (order || table.status === 'OCCUPIED') return 'occupied';
    return 'free';
}

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Tolerates empty or odd payloads (offline cache, server hiccups): never throws. */
export function normalizePlan(data: unknown): Plan {
    const d = isObject(data) ? data : {};
    return {
        canvasWidth: Number(d.canvasWidth) > 0 ? Number(d.canvasWidth) : 1600,
        canvasHeight: Number(d.canvasHeight) > 0 ? Number(d.canvasHeight) : 1000,
        areas: Array.isArray(d.areas) ? (d.areas as PlanArea[]) : [],
        tables: Array.isArray(d.tables) ? (d.tables as PlanTable[]) : [],
    };
}

export function normalizeOrders(data: unknown): ActiveOrder[] {
    return Array.isArray(data) ? (data as ActiveOrder[]) : [];
}

export function ordersByTable(orders: ActiveOrder[]): Map<number, ActiveOrder> {
    const map = new Map<number, ActiveOrder>();
    for (const order of orders) {
        const tableId = order.tableId ?? order.table?.id;
        if (tableId == null) continue;
        const prev = map.get(tableId);
        // Oldest open account wins when a table somehow has several.
        if (!prev || String(order.createdAt ?? '') < String(prev.createdAt ?? '')) map.set(tableId, order);
    }
    return map;
}

/** A tappable block on the plan: one table, or all the tables of a merged group drawn as one block. */
export interface TableUnit {
    key: string;
    tables: PlanTable[];
    primary: PlanTable;
    x: number;
    y: number;
    w: number;
    h: number;
}

export function buildUnits(tables: PlanTable[]): TableUnit[] {
    const units: TableUnit[] = [];
    const groups = new Map<number, PlanTable[]>();
    for (const table of tables) {
        if (table.activeTableGroupId) {
            const members = groups.get(table.activeTableGroupId) ?? [];
            members.push(table);
            groups.set(table.activeTableGroupId, members);
        } else {
            units.push({ key: `t${table.id}`, tables: [table], primary: table, x: table.mapX, y: table.mapY, w: table.mapWidth, h: table.mapHeight });
        }
    }
    for (const [groupId, members] of groups) {
        const primaryId = members[0]?.activeTableGroup?.primaryTableId;
        const primary = members.find((m) => m.id === primaryId) ?? members[0];
        const x = Math.min(...members.map((m) => m.mapX));
        const y = Math.min(...members.map((m) => m.mapY));
        const x2 = Math.max(...members.map((m) => m.mapX + m.mapWidth));
        const y2 = Math.max(...members.map((m) => m.mapY + m.mapHeight));
        units.push({ key: `g${groupId}`, tables: members, primary, x, y, w: x2 - x, h: y2 - y });
    }
    return units;
}

/** The order of a unit: its primary table's, else any member's. */
export function unitOrder(unit: TableUnit, byTable: Map<number, ActiveOrder>): ActiveOrder | undefined {
    return byTable.get(unit.primary.id) ?? unit.tables.map((t) => byTable.get(t.id)).find(Boolean);
}

export function elapsedMinutes(createdAt: string | undefined, now: number): number | null {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((now - ms) / 60_000));
}

export function formatElapsed(minutes: number | null): string {
    if (minutes === null) return '';
    if (minutes < 60) return `${minutes} min`;
    const rest = minutes % 60;
    return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

export function initialsOf(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('');
}
