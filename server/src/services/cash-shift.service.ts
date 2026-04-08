import type { DocumentType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class CashShiftService {
    static async getAll(companyId: number, filters?: {
        cashRegisterId?: number;
        userId?: number;
        status?: 'OPEN' | 'CLOSED';
        startDate?: string;
        endDate?: string;
    }) {
        const where: Prisma.CashShiftWhereInput = { companyId };

        if (filters?.cashRegisterId) {
            where.cashRegisterId = filters.cashRegisterId;
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
        if (data.startAmount < 0) {
            throw new Error('El monto inicial no puede ser negativo');
        }

        // Wrap check + create in a transaction to prevent race condition
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
                throw new Error('Cash register already has an open shift');
            }

            return await tx.cashShift.create({
                data: {
                    ...data,
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
        const shift = await prisma.cashShift.findFirst({
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
        const difference = endAmount - expectedBalance;

        return await prisma.cashShift.update({
            where: { id },
            data: {
                endDate: new Date(),
                endAmount,
                difference,
                notes
            },
            include: {
                cashRegister: true,
                user: true,
                movements: true
            }
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
        if (!data.amount || data.amount <= 0) {
            throw new Error('El monto debe ser mayor a 0');
        }
        if (!['IN', 'OUT'].includes(data.type)) {
            throw new Error('Tipo de movimiento inválido');
        }

        const shift = await prisma.cashShift.findFirst({
            where: { id: shiftId, companyId }
        });

        if (!shift) {
            throw new Error('Turno de caja no encontrado');
        }

        if (shift.endDate) {
            throw new Error('No se pueden agregar movimientos a turnos cerrados');
        }

        // Build creation data
        const createData: Prisma.CashMovementUncheckedCreateInput = {
            shiftId,
            type: data.type,
            amount: data.amount,
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

        return await prisma.cashMovement.create({
            data: createData,
            include: {
                supplier: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
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

        if (movement.shift.endDate) {
            throw new Error('Cannot delete movements from closed shifts');
        }

        return await prisma.cashMovement.delete({
            where: { id: movementId }
        });
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
        const totalSalesCash = movementsIn
            .filter(
                (m) =>
                    m.reference &&
                    (m.reference.toLowerCase().includes('order') ||
                        m.description?.toLowerCase().includes('venta'))
            )
            .reduce((sum, m) => sum + Number(m.amount), 0);

        const expectedBalance = Number(shift.startAmount) + totalIn - totalOut;
        const actualBalance = shift.endAmount ? Number(shift.endAmount) : null;
        const difference = actualBalance !== null ? actualBalance - expectedBalance : null;

        return {
            shift,
            summary: {
                startAmount: Number(shift.startAmount),
                totalIn,
                totalOut,
                totalSalesCash,
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
