import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class ReservationService {
    private static async checkAvailabilityWithClient(
        db: Prisma.TransactionClient | typeof prisma,
        branchId: number,
        companyId: number,
        date: Date,
        peopleCount: number,
        excludeReservationId?: number
    ): Promise<boolean> {
        // Range: reservation time +/- 2 hours
        const startTime = new Date(date.getTime() - 2 * 60 * 60 * 1000);
        const endTime = new Date(date.getTime() + 2 * 60 * 60 * 1000);

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
                status: { not: 'OUT_OF_SERVICE' }
            }
        });

        if (compatibleTables.length === 0) return false;

        // 2. Count active reservations in that time bracket
        const conflictCount = await db.reservation.count({
            where: {
                branchId,
                companyId,
                status: { in: ['PENDING', 'CONFIRMED'] },
                date: {
                    gte: startTime,
                    lte: endTime
                },
                ...(excludeReservationId ? { id: { not: excludeReservationId } } : {})
            }
        });

        // Simple availability: total tables capable of holding peopleCount vs reservations at that time
        return compatibleTables.length > conflictCount;
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
                }
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
                }
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
        if (new Date(data.date) < now) {
            throw new Error('Reservation date must be in the future');
        }

        // Validate people count
        if (data.peopleCount < 1) {
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
            const isAvailable = await this.checkAvailabilityWithClient(
                tx,
                data.branchId,
                companyId,
                new Date(data.date),
                data.peopleCount
            );
            if (!isAvailable) {
                throw new Error('No tables available for this capacity at the requested time');
            }

            return await tx.reservation.create({
                data: {
                    ...data,
                    companyId,
                    status: 'PENDING'
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

    /**
     * Private helper to check availability
     */
    private static async checkAvailability(branchId: number, companyId: number, date: Date, peopleCount: number, excludeReservationId?: number): Promise<boolean> {
        return this.checkAvailabilityWithClient(prisma, branchId, companyId, date, peopleCount, excludeReservationId);
    }

    static async update(id: number, companyId: number, data: {
        customerName?: string;
        phone?: string;
        email?: string;
        date?: Date;
        peopleCount?: number;
        notes?: string;
    }) {
        // Always load the reservation scoped to the tenant before mutating it.
        const current = await prisma.reservation.findFirst({ where: { id, companyId } });
        if (!current) {
            throw new Error('Reservation not found');
        }

        // Whitelist updatable fields. `status` is intentionally excluded so it can
        // only change through updateStatus(), which enforces VALID_STATUS_TRANSITIONS.
        const updateData: Prisma.ReservationUpdateInput = {};
        if (data.customerName !== undefined) updateData.customerName = data.customerName;
        if (data.phone !== undefined) updateData.phone = data.phone;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.date !== undefined) updateData.date = data.date;
        if (data.peopleCount !== undefined) updateData.peopleCount = data.peopleCount;

        // If updating date or peopleCount, validate it's in the future and check availability
        if (data.date || data.peopleCount) {
            const newDate = data.date ? new Date(data.date) : current.date;
            const newPeopleCount = data.peopleCount || current.peopleCount;

            if (newDate < new Date()) {
                throw new Error('Reservation date must be in the future');
            }

            const isAvailable = await this.checkAvailability(current.branchId, companyId, newDate, newPeopleCount, id);
            if (!isAvailable) {
                throw new Error('No tables available for this capacity at the requested time');
            }
        }

        return await prisma.reservation.update({
            where: { id },
            data: updateData,
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

    private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
        'PENDING': ['CONFIRMED', 'CANCELLED'],
        'CONFIRMED': ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
        'COMPLETED': [],
        'CANCELLED': [],
        'NO_SHOW': []
    };

    static async updateStatus(
        id: number,
        companyId: number,
        status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED'
    ) {
        const reservation = await this.getById(id, companyId);

        const currentStatus = reservation.status;
        const validNext = this.VALID_STATUS_TRANSITIONS[currentStatus] || [];
        if (!validNext.includes(status)) {
            throw new Error(`Transición de estado inválida: ${currentStatus} → ${status}`);
        }

        return await prisma.reservation.update({
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
    }

    static async delete(id: number, companyId: number) {
        // Only allow deletion of pending or cancelled reservations
        const reservation = await prisma.reservation.findFirst({
            where: { id, companyId }
        });

        if (!reservation) {
            throw new Error('Reservation not found');
        }

        if (!['PENDING', 'CANCELLED'].includes(reservation.status)) {
            throw new Error('Can only delete pending or cancelled reservations');
        }

        return await prisma.reservation.delete({
            where: { id }
        });
    }

    // Get available tables for a reservation
    static async getAvailableTables(branchId: number, companyId: number, date: Date, peopleCount: number) {
        // Get all tables in the branch with sufficient capacity
        const tables = await prisma.table.findMany({
            where: {
                branchId,
                companyId,
                capacity: {
                    gte: peopleCount
                },
                status: {
                    in: ['AVAILABLE', 'RESERVED']
                }
            },
            orderBy: {
                capacity: 'asc' // Prefer smaller tables first
            }
        });

        // Check which tables are available at the requested time
        // For now, we'll return all tables with sufficient capacity
        // In a real system, you'd check for other reservations at the same time
        return tables;
    }

    // Get today's reservations
    static async getTodayReservations(companyId: number, branchId?: number) {
        const today = new Date();
        return await this.getAll(companyId, { branchId, date: today });
    }

    // Get upcoming reservations
    static async getUpcomingReservations(companyId: number, branchId?: number, days: number = 7) {
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
