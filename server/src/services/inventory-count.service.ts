import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { InventoryCountError } from './inventory-count-errors';
import { assertBranchAccess, resolveBranchScope } from '../utils/branch-scope';
import { UnitConversionService } from './unit-conversion.service';

export interface InventoryCountActor {
    userId: number;
    companyId: number;
    branchId?: number | null;
    role?: string;
    roles?: string[];
}

type Db = Prisma.TransactionClient | typeof prisma;
type ReqUser = Parameters<typeof assertBranchAccess>[0];

export type CountDisplayStatus = 'EN_CURSO' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO' | 'DEVUELTO';

export interface InventoryCountListFilters {
    status?: string;
    page?: number;
    pageSize?: number;
}

const STATUS_FILTERS: Record<string, Prisma.InventoryCountSheetWhereInput['status'] | undefined> = {
    open: 'DRAFT',
    review: 'SUBMITTED',
    approved: 'APPROVED',
    all: undefined,
};
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const NO_CATEGORY = 'Sin categoría';
const MAX_ID = 2147483647;
const MAX_COUNTED_QUANTITY = 1_000_000_000;
const MAX_UNIT_LENGTH = 20;

function displayStatusOf(status: string, returnedAt: Date | null): CountDisplayStatus {
    if (status === 'APPROVED') return 'APROBADO';
    if (status === 'REJECTED') return 'RECHAZADO';
    if (status === 'SUBMITTED') return 'EN_REVISION';
    return returnedAt ? 'DEVUELTO' : 'EN_CURSO';
}

/** Counted quantity: a number with at most 3 decimals, 0 <= q <= MAX; `null` clears the line. */
function parseCountedQuantity(value: unknown): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_COUNTED_QUANTITY) {
        throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    }
    if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    return value;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

const asUser = (actor: InventoryCountActor) => actor as unknown as ReqUser;

/** Branch filter of list endpoints: undefined for company-wide users; pinned users also see central (null-branch) rows. */
function branchFilter(actor: InventoryCountActor): { OR: Array<{ branchId: number | null }> } | undefined {
    const branchId = resolveBranchScope(asUser(actor));
    return branchId === undefined ? undefined : { OR: [{ branchId }, { branchId: null }] };
}

/** Products shown in an inventory screen: active, with a categoria that is not hidden from inventory. */
function inScopeWhere(companyId: number, warehouseId: number): Prisma.ProductWhereInput {
    return {
        companyId,
        active: true,
        stocks: { some: { warehouseId } },
        OR: [{ categoryId: null }, { category: { showInInventory: true } }],
    };
}

function intId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_ID) {
        throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    }
    return value;
}

/** `null` = whole warehouse; otherwise a non-empty, de-duplicated list where a `null` entry means "Sin categoría". */
export function normalizeCategoryIds(raw: unknown): Array<number | null> | null {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    const out: Array<number | null> = [];
    for (const entry of raw) {
        const id = entry === null ? null : intId(entry);
        if (!out.includes(id)) out.push(id);
    }
    return out;
}

function scopeClause(categoryIds: Array<number | null> | null): Prisma.ProductWhereInput {
    if (categoryIds === null) return {};
    const ids = categoryIds.filter((id): id is number => id !== null);
    const clauses: Prisma.ProductWhereInput[] = [];
    if (ids.length > 0) clauses.push({ categoryId: { in: ids } });
    if (categoryIds.includes(null)) clauses.push({ categoryId: null });
    return { AND: [{ OR: clauses }] };
}

export class InventoryCountService {
    private static async accessibleWarehouse(actor: InventoryCountActor, warehouseId: number) {
        const warehouse = await prisma.warehouse.findFirst({
            where: { id: warehouseId, companyId: actor.companyId },
            select: { id: true, branchId: true, type: true, name: true },
        });
        if (!warehouse) throw new InventoryCountError('INVENTORY_COUNT_NOT_FOUND', 'Bodega no encontrada');
        assertBranchAccess(asUser(actor), warehouse.branchId, { allowGlobal: true });
        return warehouse;
    }

    /** Products a count of this scope covers; reused by the line/recount flows. */
    static async productsInScope(
        db: Db,
        companyId: number,
        warehouseId: number,
        categoryIds: Array<number | null> | null,
    ): Promise<Array<{ productId: number; categoryId: number | null }>> {
        const products = await db.product.findMany({
            where: { AND: [inScopeWhere(companyId, warehouseId), scopeClause(categoryIds)] },
            select: { id: true, categoryId: true },
            orderBy: { id: 'asc' },
        });
        return products.map((p) => ({ productId: p.id, categoryId: p.categoryId }));
    }

    static async warehouses(actor: InventoryCountActor) {
        const where: Prisma.WarehouseWhereInput = { companyId: actor.companyId, ...branchFilter(actor) };
        const warehouses = await prisma.warehouse.findMany({
            where,
            select: { id: true, name: true, type: true },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
        if (warehouses.length === 0) return [];
        const ids = warehouses.map((w) => w.id);
        const [counts, open, last] = await Promise.all([
            prisma.stock.groupBy({
                by: ['warehouseId'],
                where: { companyId: actor.companyId, warehouseId: { in: ids }, product: { active: true, OR: [{ categoryId: null }, { category: { showInInventory: true } }] } },
                _count: { _all: true },
            }),
            prisma.inventoryCountSheet.findMany({
                where: { companyId: actor.companyId, warehouseId: { in: ids }, openWarehouseId: { not: null } },
                select: { id: true, warehouseId: true, status: true },
            }),
            prisma.inventoryCountSheet.groupBy({
                by: ['warehouseId'],
                where: { companyId: actor.companyId, warehouseId: { in: ids }, status: 'APPROVED' },
                _max: { approvedAt: true },
            }),
        ]);
        const countOf = new Map(counts.map((c) => [c.warehouseId, c._count._all]));
        const openOf = new Map(open.map((s) => [s.warehouseId, s]));
        const lastOf = new Map(last.map((s) => [s.warehouseId, s._max.approvedAt]));
        return warehouses.map((w) => {
            const sheet = openOf.get(w.id);
            return {
                id: w.id,
                name: w.name,
                type: w.type,
                productCount: countOf.get(w.id) ?? 0,
                lastCountAt: lastOf.get(w.id)?.toISOString() ?? null,
                openSheet: sheet ? { id: sheet.id, status: sheet.status as 'DRAFT' | 'SUBMITTED' } : null,
            };
        });
    }

    static async categories(actor: InventoryCountActor, warehouseId: number) {
        const warehouse = await InventoryCountService.accessibleWarehouse(actor, warehouseId);
        const groups = await prisma.product.groupBy({
            by: ['categoryId'],
            where: inScopeWhere(actor.companyId, warehouse.id),
            _count: { _all: true },
        });
        const categoryIds = groups.map((g) => g.categoryId).filter((id): id is number => id !== null);
        const categories = categoryIds.length === 0 ? [] : await prisma.category.findMany({
            where: { companyId: actor.companyId, id: { in: categoryIds } },
            select: { id: true, name: true, sortOrder: true },
        });
        const byId = new Map(categories.map((c) => [c.id, c]));
        const named = groups
            .filter((g) => g.categoryId !== null && byId.has(g.categoryId))
            .map((g) => ({ category: byId.get(g.categoryId as number)!, productCount: g._count._all }))
            .sort((a, b) => a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name, 'es'))
            .map((g) => ({ categoryId: g.category.id as number | null, name: g.category.name, productCount: g.productCount }));
        const none = groups.find((g) => g.categoryId === null);
        return none ? [...named, { categoryId: null, name: NO_CATEGORY, productCount: none._count._all }] : named;
    }

    static async start(actor: InventoryCountActor, input: { warehouseId: unknown; categoryIds?: unknown }) {
        const warehouseId = intId(input.warehouseId);
        const categoryIds = normalizeCategoryIds(input.categoryIds);
        const warehouse = await InventoryCountService.accessibleWarehouse(actor, warehouseId);
        try {
            return await prisma.$transaction(async (tx) => {
                const products = await InventoryCountService.productsInScope(tx, actor.companyId, warehouse.id, categoryIds);
                if (products.length === 0) {
                    throw new InventoryCountError('INVENTORY_COUNT_INVALID', 'No hay productos para contar en esta selección');
                }
                const sheet = await tx.inventoryCountSheet.create({
                    data: {
                        companyId: actor.companyId,
                        branchId: warehouse.branchId,
                        warehouseId: warehouse.id,
                        status: 'DRAFT',
                        scopeCategoryIds: categoryIds ?? Prisma.JsonNull,
                        openWarehouseId: warehouse.id,
                        startedById: actor.userId,
                    },
                    select: { id: true },
                });
                await tx.inventoryCountLine.createMany({
                    data: products.map((p) => ({ sheetId: sheet.id, productId: p.productId, categoryId: p.categoryId })),
                });
                return { id: sheet.id, status: 'DRAFT' as const, warehouseId: warehouse.id, productCount: products.length };
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const open = await prisma.inventoryCountSheet.findFirst({
                    where: { companyId: actor.companyId, warehouseId: warehouse.id, openWarehouseId: warehouse.id },
                    select: { id: true },
                });
                throw new InventoryCountError('INVENTORY_COUNT_WAREHOUSE_BUSY', undefined, { sheetId: open?.id ?? null });
            }
            throw error;
        }
    }

    static async list(actor: InventoryCountActor, filters: InventoryCountListFilters) {
        const statusKey = filters.status ?? 'open';
        if (!Object.prototype.hasOwnProperty.call(STATUS_FILTERS, statusKey)) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
        const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
        const page = Math.max(filters.page ?? 1, 1);
        const status = STATUS_FILTERS[statusKey];
        const where: Prisma.InventoryCountSheetWhereInput = {
            companyId: actor.companyId,
            ...(status && { status }),
            ...branchFilter(actor),
        };
        const [sheets, total] = await Promise.all([
            prisma.inventoryCountSheet.findMany({
                where,
                select: {
                    id: true, status: true, startedAt: true, returnedAt: true, scopeCategoryIds: true,
                    warehouse: { select: { name: true } },
                    startedBy: { select: { name: true } },
                },
                orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.inventoryCountSheet.count({ where }),
        ]);
        if (sheets.length === 0) return { items: [], total };

        const ids = sheets.map((s) => s.id);
        const approvedIds = sheets.filter((s) => s.status === 'APPROVED').map((s) => s.id);
        const returnedIds = sheets.filter((s) => s.status === 'DRAFT' && s.returnedAt).map((s) => s.id);
        const [progress, adjusted, recount] = await Promise.all([
            prisma.inventoryCountLine.groupBy({
                by: ['sheetId'],
                where: { sheetId: { in: ids } },
                _count: { _all: true, countedBaseQuantity: true },
            }),
            approvedIds.length === 0 ? [] : prisma.inventoryCountLine.groupBy({
                by: ['sheetId'],
                where: { sheetId: { in: approvedIds }, movementId: { not: null } },
                _count: { _all: true },
                _sum: { adjustmentValue: true },
            }),
            returnedIds.length === 0 ? [] : prisma.inventoryCountLine.groupBy({
                by: ['sheetId'],
                where: { sheetId: { in: returnedIds }, recountRequested: true },
                _count: { _all: true },
            }),
        ]);
        const progressOf = new Map(progress.map((g) => [g.sheetId, g._count]));
        const adjustedOf = new Map(adjusted.map((g) => [g.sheetId, g]));
        const recountOf = new Map(recount.map((g) => [g.sheetId, g._count._all]));
        const labels = await InventoryCountService.scopeLabels(actor.companyId, sheets.map((s) => s.scopeCategoryIds));

        const items = sheets.map((s, index) => {
            const returned = s.status === 'DRAFT' && s.returnedAt !== null;
            const displayStatus = displayStatusOf(s.status, s.returnedAt);
            let result: { differences: number; value: number } | { recount: number } | null = null;
            if (s.status === 'APPROVED') {
                const group = adjustedOf.get(s.id);
                result = {
                    differences: group?._count._all ?? 0,
                    value: Math.round(Number(group?._sum.adjustmentValue ?? 0) * 100) / 100,
                };
            } else if (returned) {
                result = { recount: recountOf.get(s.id) ?? 0 };
            }
            return {
                id: s.id,
                warehouseName: s.warehouse.name,
                startedAt: s.startedAt.toISOString(),
                startedByName: s.startedBy.name,
                status: s.status,
                displayStatus,
                productCount: progressOf.get(s.id)?._all ?? 0,
                countedCount: progressOf.get(s.id)?.countedBaseQuantity ?? 0,
                scopeLabel: labels[index],
                result,
            };
        });
        return { items, total };
    }

    /** Locks the sheet row (serializes line saves against submit) and loads it with the caller's access checked. */
    private static async lockedSheet(tx: Prisma.TransactionClient, actor: InventoryCountActor, sheetId: number) {
        await tx.$queryRaw`SELECT id FROM \`InventoryCountSheet\` WHERE id = ${sheetId} AND companyId = ${actor.companyId} FOR UPDATE`;
        return InventoryCountService.loadSheet(tx, actor, sheetId);
    }

    private static async loadSheet(db: Db, actor: InventoryCountActor, sheetId: number) {
        const sheet = await db.inventoryCountSheet.findFirst({
            where: { id: sheetId, companyId: actor.companyId },
            select: {
                id: true, branchId: true, warehouseId: true, status: true, returnedAt: true, returnNote: true, startedAt: true,
                scopeCategoryIds: true,
                warehouse: { select: { id: true, name: true } },
                startedBy: { select: { name: true } },
            },
        });
        if (!sheet) throw new InventoryCountError('INVENTORY_COUNT_NOT_FOUND');
        assertBranchAccess(asUser(actor), sheet.branchId, { allowGlobal: true });
        return sheet;
    }

    /** Blind sheet for the counter: whitelisted fields only, never expected quantities, stock or costs. */
    static async detail(actor: InventoryCountActor, sheetIdInput: unknown) {
        const sheetId = intId(sheetIdInput);
        const sheet = await InventoryCountService.loadSheet(prisma, actor, sheetId);
        const lines = await prisma.inventoryCountLine.findMany({
            where: { sheetId },
            select: {
                productId: true, categoryId: true, unit: true, countedQuantity: true, countedBaseQuantity: true, recountRequested: true,
                product: { select: { name: true, sku: true, unit: true } },
            },
            orderBy: { product: { name: 'asc' } },
        });
        const categoryIds = [...new Set(lines.map((l) => l.categoryId).filter((id): id is number => id !== null))];
        const [unitsByProduct, categories, scopeLabels] = await Promise.all([
            UnitConversionService.getAllowedUnitsForProducts(lines.map((l) => l.productId), actor.companyId, prisma),
            categoryIds.length === 0 ? [] : prisma.category.findMany({
                where: { companyId: actor.companyId, id: { in: categoryIds } },
                select: { id: true, name: true, sortOrder: true },
            }),
            InventoryCountService.scopeLabels(actor.companyId, [sheet.scopeCategoryIds]),
        ]);
        const named: Array<{ categoryId: number | null; name: string }> = [...categories]
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
            .map((c) => ({ categoryId: c.id, name: c.name }));
        if (lines.some((l) => l.categoryId === null)) named.push({ categoryId: null, name: NO_CATEGORY });

        return {
            id: sheet.id,
            status: sheet.status,
            displayStatus: displayStatusOf(sheet.status, sheet.returnedAt),
            warehouse: { id: sheet.warehouse.id, name: sheet.warehouse.name },
            startedAt: sheet.startedAt.toISOString(),
            startedByName: sheet.startedBy.name,
            scopeLabel: scopeLabels[0],
            returnNote: sheet.returnNote ?? null,
            categories: named,
            lines: lines.map((l) => {
                const units = unitsByProduct.get(l.productId) ?? [];
                return {
                    productId: l.productId,
                    name: l.product.name,
                    sku: l.product.sku ?? null,
                    categoryId: l.categoryId,
                    baseUnit: units.find((u) => u.isBase)?.abbreviation ?? l.product.unit,
                    units: units.map((u) => ({ abbreviation: u.abbreviation, name: u.name, factor: u.conversionFactor })),
                    unit: l.unit,
                    countedQuantity: l.countedQuantity === null ? null : Number(l.countedQuantity),
                    counted: l.countedBaseQuantity !== null,
                    recountRequested: l.recountRequested,
                };
            }),
        };
    }

    /**
     * Saves (or clears) one line. Stock is read here, when the server receives the save, so the later
     * adjustment (counted - expected) respects sales made in between. Older client timestamps never win.
     */
    static async saveLine(
        actor: InventoryCountActor,
        sheetIdInput: unknown,
        productIdInput: unknown,
        input: { unit?: unknown; countedQuantity?: unknown; clientCountedAt?: unknown },
    ) {
        const sheetId = intId(sheetIdInput);
        const productId = intId(productIdInput);
        const quantity = parseCountedQuantity(input.countedQuantity ?? null);
        const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
        if (unit.length === 0 || unit.length > MAX_UNIT_LENGTH) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
        const clientCountedAt = typeof input.clientCountedAt === 'string' ? new Date(input.clientCountedAt) : null;
        if (!clientCountedAt || Number.isNaN(clientCountedAt.getTime())) throw new InventoryCountError('INVENTORY_COUNT_INVALID');

        return prisma.$transaction(async (tx) => {
            const sheet = await InventoryCountService.lockedSheet(tx, actor, sheetId);
            if (sheet.status !== 'DRAFT') throw new InventoryCountError('INVENTORY_COUNT_NOT_EDITABLE');
            const line = await tx.inventoryCountLine.findUnique({
                where: { sheetId_productId: { sheetId, productId } },
                select: { id: true, countedBaseQuantity: true, clientCountedAt: true },
            });
            if (!line) throw new InventoryCountError('INVENTORY_COUNT_NOT_FOUND', 'El producto no está en este conteo');
            const counted = line.countedBaseQuantity !== null;
            if (line.clientCountedAt && clientCountedAt.getTime() <= line.clientCountedAt.getTime()) {
                return { productId, counted, applied: false };
            }
            // Only a strictly newer client timestamp may overwrite the stored line.
            const newer = { id: line.id, OR: [{ clientCountedAt: null }, { clientCountedAt: { lt: clientCountedAt } }] };

            if (quantity === null) {
                const cleared = await tx.inventoryCountLine.updateMany({
                    where: newer,
                    data: {
                        unit: null, countedQuantity: null, countedBaseQuantity: null, expectedAtCount: null,
                        countedById: null, countedAt: null, clientCountedAt, recountRequested: false,
                    },
                });
                return { productId, counted: false, applied: cleared.count > 0 };
            }

            const allowed = (await UnitConversionService.getAllowedUnitsForProducts([productId], actor.companyId, tx)).get(productId) ?? [];
            const match = allowed.find((u) => u.abbreviation.toLowerCase() === unit.toLowerCase());
            if (!match) throw new InventoryCountError('INVENTORY_COUNT_UNIT_INVALID');
            let baseQuantity = 0;
            if (quantity > 0) {
                try {
                    baseQuantity = round6((await UnitConversionService.convert(productId, actor.companyId, quantity, match.abbreviation, tx)).baseQuantity);
                } catch {
                    throw new InventoryCountError('INVENTORY_COUNT_UNIT_INVALID');
                }
            }
            const stock = await tx.stock.findFirst({
                where: { warehouseId: sheet.warehouseId, productId, companyId: actor.companyId },
                select: { quantity: true },
            });
            const saved = await tx.inventoryCountLine.updateMany({
                where: newer,
                data: {
                    unit: match.abbreviation,
                    countedQuantity: quantity,
                    countedBaseQuantity: baseQuantity,
                    expectedAtCount: Number(stock?.quantity ?? 0),
                    countedById: actor.userId,
                    countedAt: new Date(),
                    clientCountedAt,
                    recountRequested: false,
                    notCounted: false,
                },
            });
            return { productId, counted: true, applied: saved.count > 0 };
        });
    }

    /** Sends the sheet to review: uncounted lines are flagged `notCounted` (they are never adjusted). */
    static async submit(actor: InventoryCountActor, sheetIdInput: unknown) {
        const sheetId = intId(sheetIdInput);
        return prisma.$transaction(async (tx) => {
            const sheet = await InventoryCountService.lockedSheet(tx, actor, sheetId);
            if (sheet.status !== 'DRAFT') throw new InventoryCountError('INVENTORY_COUNT_NOT_EDITABLE');
            const lines = await tx.inventoryCountLine.findMany({
                where: { sheetId },
                select: { countedBaseQuantity: true, recountRequested: true },
            });
            if (lines.some((l) => l.recountRequested)) throw new InventoryCountError('INVENTORY_COUNT_RECOUNT_PENDING');
            const counted = lines.filter((l) => l.countedBaseQuantity !== null).length;
            if (counted === 0) throw new InventoryCountError('INVENTORY_COUNT_EMPTY');
            await tx.inventoryCountLine.updateMany({ where: { sheetId, countedBaseQuantity: null }, data: { notCounted: true } });
            await tx.inventoryCountSheet.update({
                where: { id: sheetId },
                data: { status: 'SUBMITTED', submittedById: actor.userId, submittedAt: new Date(), returnNote: null },
            });
            return { id: sheetId, status: 'SUBMITTED' as const, counted, notCounted: lines.length - counted };
        });
    }

    /** "Todo", the category name(s), or "N categorías" for each sheet scope. */
    private static async scopeLabels(companyId: number, scopes: Array<Prisma.JsonValue | null>): Promise<string[]> {
        const wanted = new Set<number>();
        for (const scope of scopes) {
            if (Array.isArray(scope)) for (const id of scope) if (typeof id === 'number') wanted.add(id);
        }
        const names = new Map<number, string>();
        if (wanted.size > 0) {
            const categories = await prisma.category.findMany({
                where: { companyId, id: { in: [...wanted] } },
                select: { id: true, name: true },
            });
            for (const c of categories) names.set(c.id, c.name);
        }
        return scopes.map((scope) => {
            if (!Array.isArray(scope)) return 'Todo';
            if (scope.length > 2) return `${scope.length} categorías`;
            return scope.map((id) => (typeof id === 'number' ? names.get(id) ?? 'Categoría' : NO_CATEGORY)).join(', ');
        });
    }
}
