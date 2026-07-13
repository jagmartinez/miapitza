import type { DocumentType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class CashShiftService {
    static async getAll(companyId: number, filters?: {
        cashRegisterId?: number;
        userId?: number;
        status?: 'OPEN' | 'CLOSED';
        startDate?: string;
        endDate?: string;
        branchId?: number;
    }) {
        const where: Prisma.CashShiftWhereInput = { companyId };

        if (filters?.cashRegisterId) {
            where.cashRegisterId = filters.cashRegisterId;
        }

        if (filters?.branchId) {
            where.cashRegister = { branchId: filters.branchId };
        }

        if (filters?.userId) {
            where.userId = filters.userId;
        }

        if (filters?.status) {
            if (filters.status === 'OPEN') {
                where.endDate = null;
            } else {
                where.endDate = { not: null };
            }
        }

        if (filters?.startDate || filters?.endDate) {
            where.startDate = {};
            if (filters.startDate) {
                where.startDate.gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                where.startDate.lte = new Date(filters.endDate);
            }
        }

        return await prisma.cashShift.findMany({
            where,
            include: {
                cashRegister: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: {
                                name: true
                            }
                        }
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        movements: true
                    }
                }
            },
            orderBy: {
                startDate: 'desc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const shift = await prisma.cashShift.findFirst({
            where: { id, companyId },
            include: {
                cashRegister: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                movements: {
                    orderBy: {
                        id: 'asc'
                    },
                    include: {
                        supplier: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        if (!shift) {
            throw new Error('Cash shift not found');
        }

        return shift;
    }

    static async open(companyId: number, branchId: number, data: {
        cashRegisterId: number;
        userId: number;
        startAmount: number;
    }) {
        // Validate startAmount
        if (!Number.isFinite(data.startAmount) || data.startAmount < 0) {
            throw new Error('El monto inicial no puede ser negativo');
        }
        const startAmount = Math.round(data.startAmount * 100) / 100;

        // Wrap check + create in a transaction to prevent race condition
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Serialize openings for both the user and register. Without these locks,
            // two concurrent requests can both pass the "no open shift" checks.
            await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${data.userId} AND companyId = ${companyId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM \`CashRegister\` WHERE id = ${data.cashRegisterId} AND companyId = ${companyId} FOR UPDATE`;

            const user = await tx.user.findFirst({ where: { id: data.userId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!user) throw new Error('Usuario no encontrado o inactivo para esta empresa');

            // Verify that the cash register belongs to this company
            const cashRegister = await tx.cashRegister.findFirst({
                where: {
                    id: data.cashRegisterId,
                    companyId
                },
                include: { branch: { select: { id: true } } }
            });

            if (!cashRegister) {
                throw new Error('Caja registradora no encontrada');
            }

            // Validate branch isolation
            if (cashRegister.branchId !== branchId) {
                throw new Error('La caja registradora no pertenece a esta sucursal');
            }

            // Check if there's already an open shift for this register (inside transaction)
            const activeShift = await tx.cashShift.findFirst({
                where: {
                    cashRegisterId: data.cashRegisterId,
                    companyId,
                    endDate: null
                }
            });

            if (activeShift) {
                throw new Error('Esta caja ya tiene un turno abierto');
            }

            const userActiveShift = await tx.cashShift.findFirst({
                where: { userId: data.userId, companyId, endDate: null },
                select: { id: true }
            });
            if (userActiveShift) throw new Error('El usuario ya tiene un turno de caja abierto');

            return await tx.cashShift.create({
                data: {
                    ...data,
                    startAmount,
                    companyId
                },
                include: {
                    cashRegister: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            });
        });
    }

    static async getActiveShiftByUser(userId: number, companyId: number) {
        return await prisma.cashShift.findFirst({
            where: {
                userId,
                companyId,
                endDate: null
            }
        });
    }

    static async close(id: number, companyId: number, endAmount: number, notes?: string) {
        if (!Number.isFinite(endAmount) || endAmount < 0) {
            throw new Error('El monto final debe ser un numero finito mayor o igual a 0');
        }
        const normalizedEndAmount = Math.round(endAmount * 100) / 100;
        // Read movements + update inside a single transaction, with a row lock on the
        // shift so two concurrent closes can't both compute against the same state.
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Lock the shift row (same FOR UPDATE pattern used in reservation.service).
            await tx.$queryRaw`
                SELECT id
                FROM \`CashShift\`
                WHERE id = ${id}
                  AND companyId = ${companyId}
                FOR UPDATE
            `;

            const shift = await tx.cashShift.findFirst({
                where: { id, companyId },
                include: {
                    movements: true
                }
            });

            if (!shift) {
                throw new Error('Cash shift not found');
            }

            if (shift.endDate) {
                throw new Error('Cash shift already closed');
            }

            // Calculate expected balance
            const movementTotal = shift.movements.reduce((sum, m) => {
                return sum + (m.type === 'IN' ? Number(m.amount) : -Number(m.amount));
            }, 0);

            const expectedBalance = Number(shift.startAmount) + movementTotal;
            const difference = normalizedEndAmount - expectedBalance;

            return await tx.cashShift.update({
                where: { id },
                data: {
                    endDate: new Date(),
                    endAmount: normalizedEndAmount,
                    difference,
                    notes
                },
                include: {
                    cashRegister: true,
                    user: true,
                    movements: true
                }
            });
        });
    }

    static async addMovement(shiftId: number, companyId: number, data: {
        type: 'IN' | 'OUT';
        amount: number;
        description: string;
        reference?: string;
        documentDate?: string;
        documentType?: string;
        documentNumber?: string;
        supplierId?: number;
    }) {
        // Validate amount and type
        if (!Number.isFinite(data.amount) || data.amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        const amount = Math.round(data.amount * 100) / 100;
        if (!['IN', 'OUT'].includes(data.type)) {
            throw new Error('Tipo de movimiento inválido');
        }

        // If a supplier is referenced, it must belong to this company.
        if (data.supplierId) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: data.supplierId, companyId },
                select: { id: true }
            });
            if (!supplier) throw new Error('Proveedor no encontrado para esta empresa');
        }

        // Build creation data
        const createData: Prisma.CashMovementUncheckedCreateInput = {
            shiftId,
            type: data.type,
            amount,
            description: data.description,
            reference: data.reference
        };

        // Add optional document fields
        if (data.documentDate) {
            createData.documentDate = new Date(data.documentDate);
        }
        if (data.documentType) {
            const docTypes: DocumentType[] = [
                'FACTURA',
                'RECIBO_GASTO',
                'RECIBO_CAJA',
                'NOTA_CREDITO',
                'NOTA_DEBITO'
            ];
            if (docTypes.includes(data.documentType as DocumentType)) {
                createData.documentType = data.documentType as DocumentType;
            }
        }
        if (data.documentNumber) {
            createData.documentNumber = data.documentNumber;
        }
        if (data.supplierId) {
            createData.supplierId = data.supplierId;
        }

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shiftId} AND companyId = ${companyId} FOR UPDATE`;
            const shift = await tx.cashShift.findFirst({ where: { id: shiftId, companyId }, select: { endDate: true } });
            if (!shift) throw new Error('Turno de caja no encontrado');
            if (shift.endDate) throw new Error('No se pueden agregar movimientos a turnos cerrados');
            return tx.cashMovement.create({
                data: createData,
                include: { supplier: { select: { id: true, name: true } } }
            });
        });
    }


    static async deleteMovement(movementId: number, companyId: number) {
        const movement = await prisma.cashMovement.findFirst({
            where: { id: movementId, shift: { companyId } },
            include: {
                shift: true
            }
        });

        if (!movement) {
            throw new Error('Movement not found');
        }

        throw new Error('El libro de caja es inmutable; registre un movimiento compensatorio en lugar de eliminarlo');
    }

    // Get shift summary
    static async getShiftSummary(shiftId: number, companyId: number) {
        const shift = await prisma.cashShift.findFirst({
            where: { id: shiftId, companyId },
            include: {
                movements: true,
                cashRegister: true,
                user: true
            }
        });

        if (!shift) {
            throw new Error('Cash shift not found');
        }

        const movementsIn = shift.movements.filter((m) => m.type === 'IN');
        const movementsOut = shift.movements.filter((m) => m.type === 'OUT');

        const totalIn = movementsIn.reduce((sum, m) => sum + Number(m.amount), 0);
        const totalOut = movementsOut.reduce((sum, m) => sum + Number(m.amount), 0);

        // Calculate sales (movements that reference an Order)
        const grossSalesCash = movementsIn
            .filter(
                (m) =>
                    m.reference &&
                    (m.reference.toLowerCase().includes('order') ||
                        m.description?.toLowerCase().includes('venta'))
            )
            .reduce((sum, m) => sum + Number(m.amount), 0);
        const cashRefunds = movementsOut
            .filter((m) => m.reference?.startsWith('REV-PAY-'))
            .reduce((sum, m) => sum + Number(m.amount), 0);
        const totalSalesCash = grossSalesCash - cashRefunds;

        const expectedBalance = Number(shift.startAmount) + totalIn - totalOut;
        const actualBalance = shift.endAmount !== null ? Number(shift.endAmount) : null;
        const difference = actualBalance !== null ? actualBalance - expectedBalance : null;

        return {
            shift,
            summary: {
                startAmount: Number(shift.startAmount),
                totalIn,
                totalOut,
                totalSalesCash,
                grossSalesCash,
                cashRefunds,
                expectedBalance,
                expectedAmount: expectedBalance, // Alias for frontend compatibility
                actualBalance,
                difference,
                movementCount: shift.movements.length
            }
        };
    }

    // Get active shift status for a user - validates if they can perform sales
    static async getActiveShiftStatus(userId: number, companyId: number) {
        // Find any open shift for this user
        const activeShift = await prisma.cashShift.findFirst({
            where: {
                userId,
                companyId,
                endDate: null
            },
            include: {
                cashRegister: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!activeShift) {
            return {
                hasActiveShift: false,
                shift: null,
                requiresClose: false,
                message: 'No tiene un turno de caja abierto. Debe abrir un turno para efectuar ventas.'
            };
        }

        // Check if the shift is from a previous date
        const shiftDate = new Date(activeShift.startDate).toDateString();
        const today = new Date().toDateString();
        const requiresClose = shiftDate !== today;

        if (requiresClose) {
            const shiftDateFormatted = new Date(activeShift.startDate).toLocaleDateString('es-NI', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            return {
                hasActiveShift: true,
                shift: activeShift,
                requiresClose: true,
                message: `Tiene un turno abierto del ${shiftDateFormatted} que debe cerrar antes de efectuar ventas.`
            };
        }

        return {
            hasActiveShift: true,
            shift: activeShift,
            requiresClose: false,
            message: null
        };
    }
}
