import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class SupplierService {
    static async getAll(companyId: number, active?: boolean) {
        const where: Prisma.SupplierWhereInput = { companyId };
        if (active !== undefined) where.active = active;

        return await prisma.supplier.findMany({
            where,
            include: {
                _count: {
                    select: {
                        purchaseOrders: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const supplier = await prisma.supplier.findUnique({
            where: { id, companyId },
            include: {
                purchaseOrders: {
                    orderBy: {
                        date: 'desc'
                    },
                    take: 10 // Last 10 orders
                }
            }
        });

        if (!supplier) {
            throw new Error('Supplier not found');
        }

        return supplier;
    }

    static async create(companyId: number, data: {
        name: string;
        contact?: string;
        phone?: string;
        email?: string;
        address?: string;
        taxId?: string;
    }) {
        return await prisma.supplier.create({
            data: {
                ...data,
                companyId,
                active: true
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        contact?: string;
        phone?: string;
        email?: string;
        address?: string;
        taxId?: string;
        active?: boolean;
    }) {
        return await prisma.supplier.update({
            where: { id, companyId },
            data
        });
    }

    static async getPriceHistory(id: number, companyId: number, filters?: {
        productId?: number;
        dateFrom?: Date;
        dateTo?: Date;
    }) {
        const where: Prisma.PurchaseOrderItemWhereInput = {
            purchaseOrder: {
                supplierId: id,
                companyId,
                status: 'RECEIVED',
                ...(filters?.dateFrom || filters?.dateTo
                    ? {
                          date: {
                              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                              ...(filters.dateTo ? { lte: filters.dateTo } : {})
                          }
                      }
                    : {})
            }
        };

        if (filters?.productId) where.productId = filters.productId;

        const items = await prisma.purchaseOrderItem.findMany({
            where,
            include: {
                product: { select: { id: true, name: true, sku: true, unit: true } },
                purchaseOrder: {
                    select: { id: true, date: true, branchId: true, branch: { select: { name: true } } }
                }
            },
            orderBy: { purchaseOrder: { date: 'desc' } }
        });

        return items.map((item) => ({
            productId: item.product.id,
            productName: item.product.name,
            productSku: item.product.sku,
            unit: item.product.unit,
            unitCost: Number(item.cost),
            quantity: Number(item.quantity),
            subtotal: Number(item.subtotal),
            date: item.purchaseOrder.date,
            purchaseOrderId: item.purchaseOrder.id,
            branchName: item.purchaseOrder.branch?.name
        }));
    }

    static async delete(id: number, companyId: number) {
        // Check if supplier has purchase orders
        const orders = await prisma.purchaseOrder.findFirst({
            where: { supplierId: id, supplier: { companyId } }
        });

        if (orders) {
            throw new Error('Cannot delete supplier with existing purchase orders');
        }

        return await prisma.supplier.delete({
            where: { id, companyId }
        });
    }
}
