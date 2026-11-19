import { jest } from '@jest/globals';

/**
 * Minimal in-memory Prisma transaction double for the inventory engine and the
 * reversal flows built on it. Raw (locking) queries answer [] so the engine
 * uses its plain-read fallbacks against this state.
 */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Row[]).some((sub) => matches(row, sub));
        if (key === 'AND') return (condition as Row[]).every((sub) => matches(row, sub));
        if (key === 'warehouseId_productId') {
            const { warehouseId, productId } = condition as { warehouseId: number; productId: number };
            return row.warehouseId === warehouseId && row.productId === productId;
        }
        const value = row[key];
        if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
            const ops = condition as Row;
            if ('in' in ops && !(ops.in as unknown[]).includes(value)) return false;
            if ('gt' in ops && !(Number(value) > Number(ops.gt))) return false;
            if ('lt' in ops && !(Number(value) < Number(ops.lt))) return false;
            if ('gte' in ops && !(value != null && Number(value) >= Number(ops.gte))) return false;
            if ('lte' in ops && !(Number(value) <= Number(ops.lte))) return false;
            if ('endsWith' in ops && !(typeof value === 'string' && value.endsWith(String(ops.endsWith)))) return false;
            if ('startsWith' in ops && !(typeof value === 'string' && value.startsWith(String(ops.startsWith)))) return false;
            if ('not' in ops && (value == null || value === ops.not)) return false;
            return true;
        }
        return (value ?? null) === condition;
    });
}

function sortRows<T extends Row>(rows: T[], orderBy: unknown): T[] {
    const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, 'asc' | 'desc'>>;
    return [...rows].sort((a, b) => {
        for (const order of orders) {
            const [key, dir] = Object.entries(order)[0];
            const av = a[key] instanceof Date ? (a[key] as Date).getTime() : Number(a[key]);
            const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : Number(b[key]);
            if (av !== bv) return dir === 'desc' ? bv - av : av - bv;
        }
        return 0;
    });
}

export function makeInventoryLedger(opts: {
    costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
    avgCost: number;
    averageCostKnown?: boolean;
    /**
     * Opt-in branch routing fixture: warehouses (with branch/type), routing
     * rules (InventoryWarehouseRoute), product categories, selected order
     * modifiers and an AuditLog store for consumeForOrder end-to-end tests.
     */
    routing?: {
        warehouses: Array<{ id: number; branchId: number | null; type: 'BRANCH' | 'CENTRAL' }>;
        routes: Array<{ warehouseId: number; categoryId?: number | null; productId?: number | null; branchId: number }>;
        productCategories: Record<number, number | null>;
        orderItemModifiers?: Row[];
    };
}) {
    const stocks: Row[] = [];
    const batches: Row[] = [];
    const movements: Row[] = [];
    const slices: Row[] = [];
    const warehouses: Row[] = opts.routing
        ? opts.routing.warehouses.map((w) => ({ companyId: 1, ...w }))
        : [1, 2, 3].map((id) => ({ id, companyId: 1, branchId: null }));
    const auditLogs: Row[] = [];
    let clock = Date.UTC(2026, 0, 1);
    const tick = () => new Date((clock += 1000));

    const tx = {
        $queryRaw: jest.fn(async () => []),
        company: { findUnique: jest.fn(async () => ({ costingMethod: opts.costingMethod })) },
        warehouse: { findFirst: jest.fn(async ({ where }: { where: Row }) => warehouses.find((w) => matches(w, where)) ?? null) },
        product: {
            findFirst: jest.fn(async () => ({
                id: 1,
                name: 'P',
                currentAverageCost: opts.avgCost,
                averageCostKnown: opts.averageCostKnown ?? true,
                cost: opts.avgCost,
                referenceCostKnown: true
            })),
            update: jest.fn(async () => ({})),
            findMany: jest.fn(async ({ where }: { where?: Row }) => {
                const ids = ((where?.id as Row | undefined)?.in as number[] | undefined) ?? [];
                return ids.map((id) => ({ id, categoryId: opts.routing?.productCategories[id] ?? null }));
            })
        },
        ...(opts.routing ? {
            inventoryWarehouseRoute: {
                findMany: jest.fn(async ({ where }: { where?: Row }) => opts.routing!.routes
                    .map((route, index) => ({ id: index + 1, companyId: 1, categoryId: null, productId: null, ...route }))
                    .filter((route) => matches(route, where))
                    .map((route) => ({
                        ...route,
                        warehouse: warehouses.find((w) => w.id === route.warehouseId) ?? null
                    })))
            },
            orderItemModifier: { findMany: jest.fn(async () => opts.routing!.orderItemModifiers ?? []) },
            auditLog: {
                create: jest.fn(async ({ data }: { data: Row }) => {
                    const row = { id: auditLogs.length + 1, ...data };
                    auditLogs.push(row);
                    return { ...row };
                }),
                findFirst: jest.fn(async ({ where, orderBy }: { where?: Row; orderBy?: unknown }) =>
                    sortRows(auditLogs.filter((row) => matches(row, where)), orderBy ?? { id: 'asc' })[0] ?? null)
            }
        } : {}),
        stock: {
            findUnique: jest.fn(async ({ where }: { where: Row }) => {
                const row = stocks.find((s) => (where.id != null ? s.id === where.id : matches(s, where)));
                return row ? { ...row } : null;
            }),
            create: jest.fn(async ({ data }: { data: Row }) => {
                const row = { id: stocks.length + 1, negativeBalanceCost: 0, ...data };
                stocks.push(row);
                return { ...row };
            }),
            update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
                const row = stocks.find((s) => s.id === where.id)!;
                Object.assign(row, data);
                return { ...row };
            }),
            aggregate: jest.fn(async ({ where }: { where: Row }) => ({
                _sum: { quantity: stocks.filter((s) => matches(s, where)).reduce((sum, s) => sum + Number(s.quantity), 0) }
            }))
        },
        inventoryBatch: {
            findFirst: jest.fn(async ({ where, orderBy }: { where?: Row; orderBy?: unknown }) => {
                const row = sortRows(batches.filter((b) => matches(b, where)), orderBy ?? { id: 'asc' })[0];
                return row ? { ...row } : null;
            }),
            findMany: jest.fn(async ({ where, orderBy }: { where?: Row; orderBy?: unknown }) =>
                sortRows(batches.filter((b) => matches(b, where)), orderBy ?? [{ createdAt: 'asc' }, { id: 'asc' }]).map((b) => ({ ...b }))),
            create: jest.fn(async ({ data }: { data: Row }) => {
                const row = { id: batches.length + 1, sourceMovementId: null, createdAt: tick(), ...data };
                batches.push(row);
                return { id: row.id };
            }),
            update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
                Object.assign(batches.find((b) => b.id === where.id)!, data);
                return {};
            }),
            updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
                const rows = batches.filter((b) => matches(b, where));
                rows.forEach((b) => Object.assign(b, data));
                return { count: rows.length };
            })
        },
        inventoryDeficitSlice: {
            findMany: jest.fn(async ({ where, orderBy }: { where?: Row; orderBy?: unknown }) =>
                sortRows(slices.filter((row) => matches(row, where)), orderBy ?? { id: 'asc' }).map((row) => ({ ...row }))),
            create: jest.fn(async ({ data }: { data: Row }) => {
                const row = { id: slices.length + 1, saleMovementId: null, coveringMovementId: null, coveredValue: 0, createdAt: tick(), ...data };
                slices.push(row);
                return { ...row };
            }),
            update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
                const row = slices.find((candidate) => candidate.id === where.id)!;
                Object.assign(row, data);
                return { ...row };
            })
        },
        inventoryMovement: {
            create: jest.fn(async ({ data }: { data: Row }) => {
                const row = { id: movements.length + 1, createdAt: tick(), ...data };
                movements.push(row);
                return { id: row.id };
            }),
            findFirst: jest.fn(async ({ where, orderBy }: { where?: Row; orderBy?: unknown }) =>
                sortRows(movements.filter((m) => matches(m, where)), orderBy ?? { id: 'asc' })[0] ?? null),
            findMany: jest.fn(async ({ where, orderBy, include }: { where?: Row; orderBy?: unknown; include?: Row }) =>
                sortRows(movements.filter((m) => matches(m, where)), orderBy ?? { id: 'asc' }).map((m) => ({
                    ...m,
                    ...(include?.warehouse ? { warehouse: warehouses.find((w) => w.id === m.warehouseId) } : {})
                })))
        }
    };

    const stockOf = (warehouseId: number, productId = 1) =>
        stocks.find((s) => s.warehouseId === warehouseId && s.productId === productId);
    const layersOf = (warehouseId: number, productId = 1) =>
        batches.filter((b) => b.warehouseId === warehouseId && b.productId === productId && Number(b.remainingQty) > 1e-9);
    const layerValue = (warehouseId: number, productId = 1) =>
        layersOf(warehouseId, productId).reduce((sum, b) => sum + Number(b.remainingQty) * Number(b.unitCost), 0);
    /** Signed COGS contribution of the true-up rows (OUT = extra COGS). */
    const trueUpCogs = () => movements
        .filter((m) => m.origin === 'COST_TRUE_UP')
        .reduce((sum, m) => sum + (m.direction === 'OUT' ? 1 : -1) * Number(m.totalCost), 0);

    /**
     * Signed sum of every movement value of a warehouse: inbound +, outbound -
     * (true-up rows by their direction). Must equal the remaining layer value
     * minus the provisional cost of the open deficit.
     */
    const ledgerSum = (warehouseId: number, productId = 1) => movements
        .filter((m) => m.warehouseId === warehouseId && m.productId === productId)
        .reduce((sum, m) => {
            const direction = m.direction ?? (m.type === 'OUT' ? 'OUT' : 'IN');
            return sum + (direction === 'OUT' ? -1 : 1) * Number(m.totalCost);
        }, 0);
    const openDeficitCost = (warehouseId: number, productId = 1) => {
        const stock = stockOf(warehouseId, productId);
        return stock && Number(stock.quantity) < 0 ? Number(stock.negativeBalanceCost ?? 0) : 0;
    };

    /** Open slices (deficit queue) and their provisional value. */
    const openSlices = (warehouseId: number, productId = 1) => slices.filter((row) =>
        row.warehouseId === warehouseId && row.productId === productId
        && row.coveringMovementId == null && Number(row.quantity) > 1e-9);
    const openSliceValue = (warehouseId: number, productId = 1) => openSlices(warehouseId, productId)
        .reduce((sum, row) => sum + Number(row.quantity) * Number(row.provisionalUnitCost), 0);

    return {
        tx, stocks, batches, movements, slices, auditLogs, stockOf, layersOf, layerValue, trueUpCogs, ledgerSum, openDeficitCost,
        openSlices, openSliceValue
    };
}
