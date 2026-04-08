import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class WarehouseService {
    static async getAll(companyId: number, branchId?: number, type?: 'CENTRAL' | 'BRANCH') {
        const where: Prisma.WarehouseWhereInput = { companyId };
        if (branchId) where.branchId = branchId;
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

        const normalizedCode = (data.code || data.name)
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32);

        return await prisma.warehouse.create({
            data: {
                companyId,
                branchId,
                type: warehouseType,
                name: data.name,
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
        const existing = await prisma.warehouse.findFirst({
            where: { id, companyId }
        });

        if (!existing) {
            throw new Error('Warehouse not found');
        }

        let branchId = data.branchId ?? existing.branchId ?? null;
        const warehouseType = data.type || existing.type;

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

        return await prisma.warehouse.update({
            where: { id },
            data: {
                ...(data.name ? { name: data.name } : {}),
                ...(data.code ? { code: data.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) } : {}),
                type: warehouseType,
                branchId
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

    static async delete(id: number, companyId: number) {
        // Check if warehouse has stock
        const stocks = await prisma.stock.findFirst({
            where: { warehouseId: id, warehouse: { companyId } }
        });

        if (stocks) {
            throw new Error('Cannot delete warehouse with existing stock');
        }

        return await prisma.warehouse.delete({
            where: { id }
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
                        minStock: true,
                        cost: true
                    }
                }
            }
        });
    }
}
