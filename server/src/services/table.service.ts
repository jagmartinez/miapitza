import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class TableService {
  static async getAll(companyId: number, branchId?: number) {
    const where: Prisma.TableWhereInput = { companyId };
    if (branchId) where.branchId = branchId;

    return await prisma.table.findMany({
      where,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true
          }
        }
      },
      orderBy: [
        { branchId: 'asc' },
        { number: 'asc' }
      ]
    });
  }

  static async getById(id: number, companyId: number) {
    const table = await prisma.table.findFirst({
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
        orders: {
          where: {
            status: {
              in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED']
            },
            companyId
          },
          select: {
            id: true,
            total: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    if (!table) {
      throw new Error('Table not found');
    }

    return table;
  }

  static async getByBranch(branchId: number, companyId: number) {
    return await this.getAll(companyId, branchId);
  }

  static async create(companyId: number, data: {
    branchId: number;
    number: string;
    capacity: number;
    location?: string;
  }) {
    // Check if branch exists and belongs to company
    const branch = await prisma.branch.findFirst({
      where: { id: data.branchId, companyId }
    });

    if (!branch) {
      throw new Error('Branch not found or unauthorized');
    }

    // Check if table number exists in the same branch
    const existing = await prisma.table.findFirst({
      where: {
        branchId: data.branchId,
        companyId,
        number: data.number
      }
    });

    if (existing) {
      throw new Error('Table with this number already exists in this branch');
    }

    return await prisma.table.create({
      data: {
        ...data,
        companyId,
        status: 'AVAILABLE'
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
    number?: string;
    capacity?: number;
    location?: string;
    status?: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE';
  }) {
    // Verify ownership
    await this.getById(id, companyId);

    return await prisma.table.update({
      where: { id },
      data,
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
    // Check if table has active orders
    const activeOrders = await prisma.order.findFirst({
      where: {
        tableId: id,
        companyId,
        status: {
          in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED']
        }
      }
    });

    if (activeOrders) {
      throw new Error('Cannot delete table with active orders');
    }

    // Verify ownership
    await this.getById(id, companyId);

    return await prisma.table.delete({
      where: { id }
    });
  }

  static async updateStatus(id: number, companyId: number, status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE') {
    return await this.update(id, companyId, { status });
  }
}
