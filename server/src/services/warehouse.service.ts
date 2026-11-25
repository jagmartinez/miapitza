import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class WarehouseService {
    static async getAll(companyId: number, branchId?: number, type?: 'CENTRAL' | 'BRANCH') {
        const where: Prisma.WarehouseWhereInput = { companyId };
        // When scoped to a branch, also include shared CENTRAL warehouses (branchId null).
        if (branchId) where.OR = [{ branchId }, { branchId: null }];
        if (type) where.type = type;

        return await prisma.warehouse.findMany({
            where,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                _count: {
                    select: {
                        stocks: true,
                        movements: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const warehouse = await prisma.warehouse.findFirst({
            where: { id, companyId },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        address: true
                    }
                },
                stocks: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                unit: true,
                                baseUnit: { select: { abbreviation: true } },
                                minStock: true,
                                type: true
                            }
                        }
                    },
                    orderBy: {
                        product: {
                            name: 'asc'
                        }
                    }
                }
            }
        });

        if (!warehouse) {
            throw new Error('Warehouse not found');
        }

        return warehouse;
    }

    static async create(companyId: number, data: {
        branchId?: number | null;
        type?: 'CENTRAL' | 'BRANCH';
        name: string;
        code?: string;
    }) {
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre de la bodega es requerido');
        const warehouseType = data.type || 'BRANCH';
        let branchId = data.branchId ?? null;

        if (warehouseType === 'BRANCH') {
            if (!branchId) {
                throw new Error('branchId is required for branch warehouses');
            }

            const branch = await prisma.branch.findFirst({
                where: { id: branchId, companyId }
            });

            if (!branch) {
                throw new Error('Branch not found or unauthorized');
            }
        } else {
            branchId = null;
        }

        const normalizedCode = (data.code || name)
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32);
        if (!normalizedCode) throw new Error('El código de la bodega no es válido');

        return await prisma.warehouse.create({
            data: {
                companyId,
                branchId,
                type: warehouseType,
                name,
                code: normalizedCode
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                }
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        branchId?: number | null;
        type?: 'CENTRAL' | 'BRANCH';
        name?: string;
        code?: string;
    }) {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const existing = await tx.warehouse.findFirst({ where: { id, companyId } });
            if (!existing) throw new Error('Warehouse not found');

            let branchId = data.branchId ?? existing.branchId ?? null;
            const warehouseType = data.type || existing.type;
            if (warehouseType === 'BRANCH') {
                if (!branchId) throw new Error('branchId is required for branch warehouses');
                const branch = await tx.branch.findFirst({ where: { id: branchId, companyId } });
                if (!branch) throw new Error('Branch not found or unauthorized');
            } else {
                branchId = null;
            }

            const scopeChanges = warehouseType !== existing.type || branchId !== existing.branchId;
            if (scopeChanges) {
                const [movements, productionOrders, nonZeroStocks] = await Promise.all([
                    tx.inventoryMovement.count({ where: { warehouseId: id, companyId } }),
                    tx.productionOrder.count({ where: { warehouseId: id, companyId } }),
                    tx.stock.count({ where: { warehouseId: id, companyId, quantity: { not: 0 } } })
                ]);
                if (movements + productionOrders + nonZeroStocks > 0) {
                    throw new Error(
                        'No se puede cambiar la sucursal o tipo de una bodega con historial o existencias; cree una nueva bodega'
                    );
                }
            }

            const name = data.name === undefined ? undefined : data.name.trim();
            if (name !== undefined && !name) throw new Error('El nombre de la bodega es requerido');
            const code = data.code === undefined
                ? undefined
                : data.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
            if (code !== undefined && !code) throw new Error('El código de la bodega no es válido');

            return tx.warehouse.update({
                where: { id },
                data: {
                    ...(name !== undefined ? { name } : {}),
                    ...(code !== undefined ? { code } : {}),
                    type: warehouseType,
                    branchId
                },
                include: { branch: { select: { id: true, name: true, code: true } } }
            });
        });
    }

    static async delete(id: number, companyId: number) {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const warehouse = await tx.warehouse.findFirst({ where: { id, companyId }, select: { id: true } });
            if (!warehouse) throw new Error('Warehouse not found');

            const [stocks, movements, productionOrders, batches] = await Promise.all([
                tx.stock.count({ where: { warehouseId: id, companyId } }),
                tx.inventoryMovement.count({ where: { warehouseId: id, companyId } }),
                tx.productionOrder.count({ where: { warehouseId: id, companyId } }),
                tx.inventoryBatch.count({ where: { warehouseId: id, companyId } })
            ]);
            if (stocks + movements + productionOrders + batches > 0) {
                throw new Error('No se puede eliminar una bodega con existencias o historial');
            }

            return tx.warehouse.delete({ where: { id } });
        });
    }

    static async getStock(warehouseId: number, companyId: number, productId?: number) {
        const where: Prisma.StockWhereInput = { warehouseId, warehouse: { companyId } };

        if (productId) {
            where.productId = productId;
        }

        return await prisma.stock.findMany({
            where,
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        unit: true,
                        baseUnit: { select: { abbreviation: true } },
                        minStock: true,
                        cost: true
                    }
                }
            }
        });
    }
}
