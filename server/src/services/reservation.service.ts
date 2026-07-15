import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class ReservationService {
    private static async getAvailableTablesWithClient(
        db: Prisma.TransactionClient | typeof prisma,
        branchId: number,
        companyId: number,
        date: Date,
        peopleCount: number,
        excludeReservationId?: number
    ) {
        // Range: reservation time +/- 2 hours
        const startTime = new Date(date.getTime() - 2 * 60 * 60 * 1000);
        const endTime = new Date(date.getTime() + 2 * 60 * 60 * 1000);
        const isNearTerm = date.getTime() - Date.now() <= 2 * 60 * 60 * 1000;

        // Lock compatible tables in this branch so concurrent booking checks serialize.
        if ('$queryRaw' in db) {
            await db.$queryRaw`
                SELECT id
                FROM \`Table\`
                WHERE branchId = ${branchId}
                  AND companyId = ${companyId}
                  AND capacity >= ${peopleCount}
                  AND status <> 'OUT_OF_SERVICE'
                FOR UPDATE
            `;
        }

        // 1. Get compatible tables
        const compatibleTables = await db.table.findMany({
            where: {
                branchId,
                companyId,
                capacity: { gte: peopleCount },
                status: isNearTerm
                    ? { in: ['AVAILABLE', 'RESERVED'] }
                    : { not: 'OUT_OF_SERVICE' }
            },
            orderBy: [{ capacity: 'asc' }, { id: 'asc' }]
        });

        if (compatibleTables.length === 0) return [];

        // Explicit assignments make conflicts exact. Legacy rows without a
        // tableId consume a conservative slot until they are edited/reassigned.
        const conflicts = await db.reservation.findMany({
            where: {
                branchId,
                companyId,
                status: { in: ['PENDING', 'CONFIRMED'] },
                date: {
                    gte: startTime,
                    lte: endTime
                },
                ...(excludeReservationId ? { id: { not: excludeReservationId } } : {})
            },
            select: { tableId: true }
        });

        const occupiedTableIds = new Set(
            conflicts.flatMap((reservation) => reservation.tableId == null ? [] : [reservation.tableId])
        );
        const unassignedLegacyCount = conflicts.filter((reservation) => reservation.tableId == null).length;
        const unoccupied = compatibleTables.filter((table) => !occupiedTableIds.has(table.id));

        return unoccupied.slice(Math.min(unassignedLegacyCount, unoccupied.length));
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        date?: Date;
        status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED';
    }) {
        const where: Prisma.ReservationWhereInput = { companyId };

        if (filters?.branchId) {
            where.branchId = filters.branchId;
        }

        if (filters?.status) {
            where.status = filters.status;
        }

        if (filters?.date) {
            // Get reservations for the entire day
            const startOfDay = new Date(filters.date);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(filters.date);
            endOfDay.setHours(23, 59, 59, 999);

            where.date = {
                gte: startOfDay,
                lte: endOfDay
            };
        }

        return await prisma.reservation.findMany({
            where,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                table: { select: { id: true, number: true, capacity: true, location: true } }
            },
            orderBy: [
                { date: 'asc' },
                { createdAt: 'desc' }
            ]
        });
    }

    static async getById(id: number, companyId: number) {
        const reservation = await prisma.reservation.findFirst({
            where: { id, companyId },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        address: true,
                        phone: true
                    }
                },
                table: { select: { id: true, number: true, capacity: true, location: true } }
            }
        });

        if (!reservation) {
            throw new Error('Reservation not found');
        }

        return reservation;
    }

    static async getByBranch(branchId: number, companyId: number, date?: Date) {
        return await this.getAll(companyId, { branchId, date });
    }

    static async create(companyId: number, data: {
        branchId: number;
        customerName: string;
        phone?: string;
        email?: string;
        date: Date;
        peopleCount: number;
        notes?: string;
    }) {
        // Validate date is in the future
        const now = new Date();
        const requestedDate = new Date(data.date);
        if (Number.isNaN(requestedDate.getTime()) || requestedDate < now) {
            throw new Error('Reservation date must be in the future');
        }

        // Validate people count
        if (!Number.isInteger(Number(data.peopleCount)) || Number(data.peopleCount) < 1) {
            throw new Error('People count must be at least 1');
        }

        // Check if branch exists and belongs to company
        const branch = await prisma.branch.findFirst({
            where: { id: data.branchId, companyId }
        });

        if (!branch) {
            throw new Error('Branch not found or unauthorized');
        }

        if (branch.status !== 'ACTIVE') {
            throw new Error('Branch is not active');
        }

        return await prisma.$transaction(async (tx) => {
            const availableTables = await this.getAvailableTablesWithClient(
                tx,
                data.branchId,
                companyId,
                new Date(data.date),
                data.peopleCount
            );
            if (availableTables.length === 0) {
                throw new Error('No tables available for this capacity at the requested time');
            }

            return await tx.reservation.create({
                data: {
                    ...data,
                    companyId,
                    tableId: availableTables[0].id,
                    status: 'PENDING'
                },
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    },
                    table: { select: { id: true, number: true, capacity: true, location: true } }
                }
            });
        });
    }

    static async update(id: number, companyId: number, data: {
        customerName?: string;
        phone?: string;
        email?: string;
        date?: Date;
        peopleCount?: number;
        notes?: string;
    }) {
        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Reservation\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const current = await tx.reservation.findFirst({ where: { id, companyId } });
            if (!current) throw new Error('Reservation not found');
            if (!['PENDING', 'CONFIRMED'].includes(current.status)) {
                throw new Error('Completed, cancelled or no-show reservations cannot be edited');
            }

            const updateData: Prisma.ReservationUpdateInput = {};
            if (data.customerName !== undefined) updateData.customerName = data.customerName;
            if (data.phone !== undefined) updateData.phone = data.phone;
            if (data.email !== undefined) updateData.email = data.email;
            if (data.notes !== undefined) updateData.notes = data.notes;

            const newDate = data.date !== undefined ? new Date(data.date) : current.date;
            const newPeopleCount = data.peopleCount !== undefined ? Number(data.peopleCount) : current.peopleCount;
            if (Number.isNaN(newDate.getTime()) || newDate < new Date()) {
                throw new Error('Reservation date must be in the future');
            }
            if (!Number.isInteger(newPeopleCount) || newPeopleCount < 1) {
                throw new Error('People count must be at least 1');
            }

            if (data.date !== undefined) updateData.date = newDate;
            if (data.peopleCount !== undefined) updateData.peopleCount = newPeopleCount;

            // Re-run allocation under the same table locks even when only contact
            // details change. This backfills legacy null tableId rows safely.
            const availableTables = await this.getAvailableTablesWithClient(
                tx, current.branchId, companyId, newDate, newPeopleCount, id
            );
            const selectedTable = availableTables.find((table) => table.id === current.tableId) ?? availableTables[0];
            if (!selectedTable) {
                throw new Error('No tables available for this capacity at the requested time');
            }
            updateData.table = { connect: { id: selectedTable.id } };

            return await tx.reservation.update({
                where: { id },
                data: updateData,
                include: {
                    branch: { select: { id: true, name: true, code: true } },
                    table: { select: { id: true, number: true, capacity: true, location: true } }
                }
            });
        });
    }

    private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
        'PENDING': ['CONFIRMED', 'CANCELLED'],
        // COMPLETED is reserved for checkIn(), which atomically creates the POS
        // order and occupies the assigned table.
        'CONFIRMED': ['CANCELLED', 'NO_SHOW'],
        'COMPLETED': [],
        'CANCELLED': [],
        'NO_SHOW': []
    };

    static async updateStatus(
        id: number,
        companyId: number,
        status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED'
    ) {
        return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \`Reservation\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
        const reservation = await tx.reservation.findFirst({ where: { id, companyId } });
        if (!reservation) throw new Error('Reservation not found');

        const currentStatus = reservation.status;
        const validNext = this.VALID_STATUS_TRANSITIONS[currentStatus] || [];
        if (!validNext.includes(status)) {
            throw new Error(`Transición de estado inválida: ${currentStatus} → ${status}`);
        }

        return await tx.reservation.update({
            where: { id },
            data: { status },
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

    static async checkIn(id: number, companyId: number, userId: number) {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Reservation\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const reservation = await tx.reservation.findFirst({
                where: { id, companyId },
                include: { table: true }
            });
            if (!reservation) throw new Error('Reservation not found');

            const existingOrder = await tx.order.findUnique({
                where: { reservationId: reservation.id },
                include: { table: true, branch: true, items: { include: { menuItem: true } } }
            });
            if (existingOrder) {
                if (reservation.status !== 'COMPLETED') {
                    throw new Error('La reservación ya tiene una orden pero su estado es inconsistente');
                }
                return { reservation, order: existingOrder };
            }

            if (reservation.status !== 'CONFIRMED') {
                throw new Error('Solo una reservación confirmada puede registrarse como llegada');
            }
            if (!reservation.tableId || !reservation.table) {
                throw new Error('La reservación no tiene una mesa asignada');
            }

            const now = new Date();
            const toleranceMs = 2 * 60 * 60 * 1000;
            if (now.getTime() < reservation.date.getTime() - toleranceMs || now.getTime() > reservation.date.getTime() + toleranceMs) {
                throw new Error('El check-in solo puede realizarse dentro de las 2 horas alrededor de la reservación');
            }

            await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${reservation.tableId} AND companyId = ${companyId} FOR UPDATE`;
            const table = await tx.table.findFirst({
                where: {
                    id: reservation.tableId,
                    companyId,
                    branchId: reservation.branchId,
                    status: { in: ['AVAILABLE', 'RESERVED'] }
                }
            });
            if (!table) throw new Error('La mesa asignada ya no está disponible');

            const activeOrder = await tx.order.findFirst({
                where: {
                    companyId,
                    branchId: reservation.branchId,
                    tableId: reservation.tableId,
                    status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
                },
                select: { id: true }
            });
            if (activeOrder) throw new Error('La mesa asignada ya tiene una orden activa');

            const branch = await tx.branch.findFirst({
                where: { id: reservation.branchId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!branch) throw new Error('La sucursal de la reservación está inactiva');

            const order = await tx.order.create({
                data: {
                    companyId,
                    branchId: reservation.branchId,
                    tableId: reservation.tableId,
                    reservationId: reservation.id,
                    userId,
                    customerName: reservation.customerName,
                    orderType: 'DINE_IN',
                    status: 'OPEN',
                    total: 0
                },
                include: { table: true, branch: true, items: { include: { menuItem: true } } }
            });

            const checkedInReservation = await tx.reservation.update({
                where: { id: reservation.id },
                data: { status: 'COMPLETED' },
                include: {
                    branch: { select: { id: true, name: true, code: true } },
                    table: { select: { id: true, number: true, capacity: true, location: true } }
                }
            });
            await tx.table.update({ where: { id: reservation.tableId }, data: { status: 'OCCUPIED' } });

            return { reservation: checkedInReservation, order };
        });
    }

    static async delete(id: number, companyId: number) {
        return prisma.$transaction(async (tx) => {
            // Serialize deletion with confirmation/completion so a stale PENDING
            // read cannot delete a concurrently confirmed reservation.
            await tx.$queryRaw`SELECT id FROM \`Reservation\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const reservation = await tx.reservation.findFirst({ where: { id, companyId } });
            if (!reservation) throw new Error('Reservation not found');
            if (!['PENDING', 'CANCELLED'].includes(reservation.status)) {
                throw new Error('Can only delete pending or cancelled reservations');
            }
            return tx.reservation.delete({ where: { id } });
        });
    }

    // Get available tables for a reservation
    static async getAvailableTables(branchId: number, companyId: number, date: Date, peopleCount: number) {
        const requestedDate = new Date(date);
        if (Number.isNaN(requestedDate.getTime()) || !Number.isInteger(peopleCount) || peopleCount < 1) return [];
        return this.getAvailableTablesWithClient(prisma, branchId, companyId, requestedDate, peopleCount);
    }

    // Get today's reservations
    static async getTodayReservations(companyId: number, branchId?: number) {
        const today = new Date();
        return await this.getAll(companyId, { branchId, date: today });
    }

    // Get upcoming reservations
    static async getUpcomingReservations(companyId: number, branchId?: number, days: number = 7) {
        if (!Number.isInteger(days) || days < 1 || days > 365) {
            throw new Error('days debe ser un entero entre 1 y 365');
        }
        const where: Prisma.ReservationWhereInput = {
            companyId,
            date: {
                gte: new Date(),
                lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
            },
            status: {
                in: ['PENDING', 'CONFIRMED']
            }
        };

        if (branchId) {
            where.branchId = branchId;
        }

        return await prisma.reservation.findMany({
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
            orderBy: {
                date: 'asc'
            }
        });
    }
}
