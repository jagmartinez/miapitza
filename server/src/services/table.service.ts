import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export type TableOperationalState =
  | 'AVAILABLE' | 'RESERVED' | 'DISABLED' | 'OPEN_ORDER' | 'WAITING_KITCHEN'
  | 'PREPARING' | 'PARTIALLY_READY' | 'READY' | 'INVOICED'
  | 'PARTIAL_PAYMENT' | 'PAID' | 'ATTENTION' | 'JOINED';

interface OperationalOrder {
  status: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';
  financialStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  invoiceNumber: string | null;
  items: Array<{ status: 'PENDING' | 'IN_PROGRESS' | 'DONE' }>;
}

export function deriveTableOperationalState(
  tableStatus: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE',
  orders: OperationalOrder[],
  isPhysicallyGrouped = false
): TableOperationalState {
  if (tableStatus === 'OUT_OF_SERVICE') return 'DISABLED';
  if (tableStatus === 'RESERVED') return 'RESERVED';
  if (orders.length === 0) {
    if (isPhysicallyGrouped) return 'JOINED';
    return tableStatus === 'OCCUPIED' ? 'ATTENTION' : 'AVAILABLE';
  }
  if (orders.some((order) => order.financialStatus === 'PARTIAL')) return 'PARTIAL_PAYMENT';
  if (orders.every((order) => order.financialStatus === 'PAID')) return 'PAID';
  if (orders.some((order) => Boolean(order.invoiceNumber))) return 'INVOICED';
  if (orders.every((order) => order.status === 'READY')) return 'READY';
  const items = orders.flatMap((order) => order.items);
  if (items.some((item) => item.status === 'DONE') && items.some((item) => item.status !== 'DONE')) {
    return 'PARTIALLY_READY';
  }
  if (orders.some((order) => order.status === 'IN_PREPARATION')) return 'PREPARING';
  if (orders.some((order) => order.status === 'SENT_TO_KITCHEN')) return 'WAITING_KITCHEN';
  return 'OPEN_ORDER';
}

export class TableService {
  static async getAll(companyId: number, branchId?: number) {
    const where: Prisma.TableWhereInput = { companyId };
    if (branchId) where.branchId = branchId;

    const tables = await prisma.table.findMany({
      where,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        activeTableGroup: {
          select: {
            id: true,
            primaryTableId: true,
            memberTableIds: true,
            status: true,
            createdAt: true,
            primaryTable: { select: { id: true, number: true } }
          }
        },
        orders: {
          where: {
            OR: [
              { status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } },
              { status: 'DELIVERED', financialStatus: { not: 'PAID' } }
            ]
          },
          select: {
            status: true,
            financialStatus: true,
            invoiceNumber: true,
            items: { select: { status: true } }
          }
        }
      },
      orderBy: [
        { branchId: 'asc' },
        { number: 'asc' }
      ]
    });
    return tables.map(({ orders, ...table }) => ({
      ...table,
      activeOrderCount: orders.length,
      operationalState: deriveTableOperationalState(table.status, orders, Boolean(table.activeTableGroup))
    }));
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
        activeTableGroup: {
          select: {
            id: true,
            primaryTableId: true,
            memberTableIds: true,
            status: true,
            createdAt: true,
            primaryTable: { select: { id: true, number: true } }
          }
        },
        orders: {
          where: {
            status: {
              in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY']
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
    const number = String(data.number || '').trim();
    const capacity = Number(data.capacity);
    if (!number) throw new Error('El número de mesa es requerido');
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('La capacidad debe ser un entero mayor a 0');
    }

    // Check if branch exists and belongs to company
    const branch = await prisma.branch.findFirst({
      where: { id: data.branchId, companyId, status: 'ACTIVE' }
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
        branchId: data.branchId,
        number,
        capacity,
        location: data.location,
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
    const number = data.number === undefined ? undefined : String(data.number).trim();
    const capacity = data.capacity === undefined ? undefined : Number(data.capacity);
    if (number !== undefined && !number) throw new Error('El número de mesa es requerido');
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity <= 0)) {
      throw new Error('La capacidad debe ser un entero mayor a 0');
    }

    return prisma.$transaction(async (tx) => {
      // Operational order and table-status writes share this row lock. This
      // prevents a manual edit from marking a table available/out-of-service
      // while another request is opening or delivering its order.
      await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
      const current = await tx.table.findFirst({ where: { id, companyId } });
      if (!current) throw new Error('Table not found');

      if (data.status !== undefined && data.status !== current.status) {
        if (current.activeTableGroupId && data.status !== 'OCCUPIED') {
          throw new Error('Separe primero el grupo físico antes de cambiar el estado de esta mesa');
        }
        const activeOrders = await tx.order.count({
          where: {
            companyId,
            tableId: id,
            status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
          }
        });
        if (activeOrders > 0 && data.status !== 'OCCUPIED') {
          throw new Error('La mesa tiene una orden activa y debe permanecer ocupada');
        }
        if (data.status === 'OCCUPIED' && activeOrders === 0 && !current.activeTableGroupId) {
          throw new Error('Una mesa solo puede marcarse ocupada mediante una orden activa');
        }
        if (data.status === 'OUT_OF_SERVICE') {
          const activeReservations = await tx.reservation.count({
            where: {
              companyId,
              tableId: id,
              status: { in: ['PENDING', 'CONFIRMED'] },
              date: { gte: new Date() }
            }
          });
          if (activeReservations > 0) {
            throw new Error('La mesa tiene reservaciones futuras activas y no puede ponerse fuera de servicio');
          }
        }
      }

      return tx.table.update({
        where: { id },
        data: {
          ...(number !== undefined ? { number } : {}),
          ...(capacity !== undefined ? { capacity } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.status !== undefined ? { status: data.status } : {})
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
    });
  }

  static async delete(id: number, companyId: number) {
    const grouped = await prisma.table.findFirst({
      where: { id, companyId, activeTableGroupId: { not: null } },
      select: { id: true }
    });
    if (grouped) throw new Error('Separe primero la mesa de su grupo activo antes de eliminarla');

    // Check if table has active orders
    const activeOrders = await prisma.order.findFirst({
      where: {
        tableId: id,
        companyId,
        status: {
          in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY']
        }
      }
    });

    if (activeOrders) {
      throw new Error('Cannot delete table with active orders');
    }

    const activeReservation = await prisma.reservation.findFirst({
      where: {
        tableId: id,
        companyId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        date: { gte: new Date() }
      },
      select: { id: true }
    });
    if (activeReservation) {
      throw new Error('No se puede eliminar una mesa con reservaciones futuras activas');
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
