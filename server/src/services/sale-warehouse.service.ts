import type { Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export type SaleWarehouseResolution =
    | { warehouseId: number; source: 'DEFAULT' | 'SINGLE' }
    | { warehouseId: null; reason: 'NO_BRANCH_WAREHOUSE' | 'AMBIGUOUS_BRANCH_WAREHOUSE' };

/**
 * Single source of truth for "which warehouse does this branch sell from".
 *
 *   1. Branch.defaultSaleWarehouseId, when it is still a BRANCH warehouse of
 *      that branch and company (it is validated on write, but a warehouse can
 *      be re-typed/moved later, so it is re-checked here and ignored if stale).
 *   2. Otherwise the legacy rule: the branch's only BRANCH warehouse.
 *   3. Zero or several BRANCH warehouses without a default -> unresolved.
 */
export class SaleWarehouseService {
    static async resolve(db: Db, companyId: number, branchId: number): Promise<SaleWarehouseResolution> {
        const branch = await db.branch.findFirst({
            where: { id: branchId, companyId },
            select: { defaultSaleWarehouseId: true }
        });
        const defaultId = branch?.defaultSaleWarehouseId ?? null;
        if (defaultId) {
            const warehouse = await db.warehouse.findFirst({
                where: { id: defaultId, companyId, branchId, type: 'BRANCH' },
                select: { id: true }
            });
            if (warehouse) return { warehouseId: warehouse.id, source: 'DEFAULT' };
        }
        const warehouses = await db.warehouse.findMany({
            where: { companyId, branchId, type: 'BRANCH' },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: 2,
        });
        if (warehouses.length === 1) return { warehouseId: warehouses[0].id, source: 'SINGLE' };
        return {
            warehouseId: null,
            reason: warehouses.length === 0 ? 'NO_BRANCH_WAREHOUSE' : 'AMBIGUOUS_BRANCH_WAREHOUSE'
        };
    }

    /**
     * Validates a default sale warehouse candidate for a branch. Returns the
     * normalized id (null clears the default). Throws a user-facing error when
     * the warehouse is not a BRANCH warehouse of that branch/company.
     */
    static async assertValidDefault(
        db: Db,
        companyId: number,
        branchId: number,
        raw: unknown
    ): Promise<number | null> {
        if (raw === null || raw === '' || raw === 0) return null;
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0) throw new Error('Bodega de venta predeterminada inválida');
        const warehouse = await db.warehouse.findFirst({
            where: { id, companyId },
            select: { id: true, branchId: true, type: true }
        });
        if (!warehouse) throw new Error('Bodega de venta predeterminada no encontrada en la empresa');
        if (warehouse.type !== 'BRANCH' || warehouse.branchId !== branchId) {
            throw new Error('La bodega de venta predeterminada debe ser una bodega de tipo sucursal de esta misma sucursal');
        }
        return warehouse.id;
    }
}
