import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Cash Register Arqueo Service
 * Detailed cash counting and reconciliation
 */
export class CashArqueoService {
    // Acceptable cash count difference (in córdobas) before a shift is flagged.
    // TODO: ideally this becomes per-company configuration (a Setting) rather than a
    // hardcoded constant, since tolerance expectations vary by business.
    private static readonly TOLERANCE = 1.0;

    private static calculateCountedAmount(breakdown: {
        bills?: { denomination: number; count: number }[];
        coins?: { denomination: number; count: number }[];
        usdBills?: { denomination: number; count: number }[];
        exchangeRate?: number;
    }) {
        const billsTotal = (breakdown.bills || []).reduce((sum, b) => sum + (b.denomination * b.count), 0);
        const coinsTotal = (breakdown.coins || []).reduce((sum, c) => sum + (c.denomination * c.count), 0);
        const usdTotal = (breakdown.usdBills || []).reduce((sum, b) => sum + (b.denomination * b.count), 0);
        const exchangeRate = breakdown.exchangeRate || 0;
        const usdInCordobas = usdTotal * exchangeRate;

        return {
            billsTotal,
            coinsTotal,
            usdTotal,
            usdInCordobas,
            exchangeRate,
            totalCounted: billsTotal + coinsTotal + usdInCordobas
        };
    }

    private static classifyDifference(difference: number) {
        const absoluteDifference = Math.abs(difference);
        return {
            difference,
            absoluteDifference,
            status: difference === 0 ? 'CUADRADO' : (difference > 0 ? 'SOBRANTE' : 'FALTANTE'),
            withinTolerance: absoluteDifference <= this.TOLERANCE,
            requiresNote: absoluteDifference > 0 && absoluteDifference <= this.TOLERANCE,
            exceedsTolerance: absoluteDifference > this.TOLERANCE,
            tolerance: this.TOLERANCE
        };
    }

    /**
     * Get detailed cash breakdown for a shift
     */
    static async getShiftDetails(shiftId: number, companyId: number) {
        const shift = await prisma.cashShift.findFirst({
            where: { id: shiftId, companyId },
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
                },
                movements: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!shift) {
            throw new Error('Turno de caja no encontrado');
        }

        // Fetch counts separately to avoid Prisma issues
        const counts = await prisma.cashCount.findMany({
            where: { shiftId },
            select: {
                id: true,
                type: true,
                denomination: true,
                count: true
            }
        });

        // Calculate totals by movement type
        const inMovements = shift.movements.filter((m) => m.type === 'IN');
        const outMovements = shift.movements.filter((m) => m.type === 'OUT');

        const totalIn = inMovements.reduce((sum, m) => sum + Number(m.amount), 0);
        const totalOut = outMovements.reduce((sum, m) => sum + Number(m.amount), 0);

        // Calculate expected vs actual
        const expectedEndAmount = Number(shift.startAmount) + totalIn - totalOut;
        const actualEndAmount = shift.endAmount ? Number(shift.endAmount) : null;
        const difference = actualEndAmount !== null ? actualEndAmount - expectedEndAmount : null;

        return {
            shift: {
                id: shift.id,
                cashRegister: shift.cashRegister.name,
                user: shift.user.name,
                startDate: shift.startDate,
                endDate: shift.endDate,
                status: shift.endDate ? 'CERRADO' : 'ABIERTO'
            },
            amounts: {
                startAmount: Number(shift.startAmount),
                expectedEndAmount,
                actualEndAmount,
                difference,
                totalIn,
                totalOut
            },
            movements: {
                in: inMovements,
                out: outMovements
            },
            counts: {
                bills:
                    counts?.filter((c) => c.type === 'BILL').map((c) => ({ denomination: Number(c.denomination), count: c.count })) || [],
                coins:
                    counts?.filter((c) => c.type === 'COIN').map((c) => ({ denomination: Number(c.denomination), count: c.count })) || [],
                usdBills:
                    counts
                        ?.filter((c) => c.type === 'USD_BILL')
                        .map((c) => ({ denomination: Number(c.denomination), count: c.count })) || []
            },
            reconciliation: {
                isBalanced: difference === 0,
                surplus: difference && difference > 0 ? difference : 0,
                deficit: difference && difference < 0 ? Math.abs(difference) : 0
            }
        };
    }

    static async previewClose(
        shiftId: number,
        companyId: number,
        closeData: {
            endAmount?: number;
            notes?: string;
            bills?: { denomination: number; count: number }[];
            coins?: { denomination: number; count: number }[];
            usdBills?: { denomination: number; count: number }[];
            exchangeRate?: number;
        }
    ) {
        const details = await this.getShiftDetails(shiftId, companyId);
        const counted = this.calculateCountedAmount(closeData);
        const endAmount = closeData.endAmount ?? counted.totalCounted;
        const differenceSummary = this.classifyDifference(endAmount - details.amounts.expectedEndAmount);

        return {
            expectedAmount: details.amounts.expectedEndAmount,
            countedAmount: endAmount,
            countedBreakdown: {
                bills: counted.billsTotal,
                coins: counted.coinsTotal,
                usdBills: counted.usdTotal,
                usdInCordobas: counted.usdInCordobas,
                exchangeRate: counted.exchangeRate
            },
            notes: closeData.notes || '',
            ...differenceSummary
        };
    }

    /**
     * Perform cash count entry (arqueo)
     */
    static async performArqueo(shiftId: number, companyId: number, cashCount: {
        bills: { denomination: number; count: number }[];
        coins: { denomination: number; count: number }[];
        usdBills?: { denomination: number; count: number }[];
        exchangeRate?: number;
        notes?: string;
    }) {
        const shift = await prisma.cashShift.findFirst({
            where: { id: shiftId, companyId }
        });

        if (!shift) {
            throw new Error('Turno de caja no encontrado');
        }

        // Calculate total from count
        const counted = this.calculateCountedAmount(cashCount);

        // Get expected amount
        const details = await this.getShiftDetails(shiftId, companyId);
        const differenceSummary = this.classifyDifference(counted.totalCounted - details.amounts.expectedEndAmount);

        return {
            counted: {
                bills: counted.billsTotal,
                coins: counted.coinsTotal,
                usdBills: counted.usdTotal,
                usdInCordobas: counted.usdInCordobas,
                total: counted.totalCounted
            },
            expected: details.amounts.expectedEndAmount,
            difference: differenceSummary.difference,
            status: differenceSummary.status,
            withinTolerance: differenceSummary.withinTolerance,
            breakdown: {
                bills: cashCount.bills,
                coins: cashCount.coins,
                usdBills: cashCount.usdBills || []
            }
        };
    }

    /**
     * Close shift with final count
     */
    static async closeShiftWithArqueo(
        shiftId: number,
        companyId: number,
        endAmount: number,
        actorRoles: string[],
        notes?: string,
        breakdown?: {
            bills: { denomination: number; count: number }[];
            coins: { denomination: number; count: number }[];
            usdBills?: { denomination: number; count: number }[];
            exchangeRate?: number;
        },
        options?: {
            forceClose?: boolean;
        }
    ) {
        const preview = await this.previewClose(shiftId, companyId, {
            endAmount,
            notes,
            bills: breakdown?.bills,
            coins: breakdown?.coins,
            usdBills: breakdown?.usdBills,
            exchangeRate: breakdown?.exchangeRate
        });
        const difference = preview.difference;
        const isAdminOverride = actorRoles.some((role) => role === 'ADMIN' || role === 'SUPERADMIN');

        if (preview.requiresNote && !notes?.trim()) {
            throw new Error('Debe agregar una observación cuando exista diferencia dentro de tolerancia.');
        }

        if (preview.exceedsTolerance) {
            if (!(options?.forceClose && isAdminOverride)) {
                const diffType = difference > 0 ? 'sobrante' : 'faltante';
                const diffAmount = Math.abs(difference).toFixed(2);
                throw new Error(
                    `No se puede cerrar el turno con ${diffType} de C$ ${diffAmount}. ` +
                    `La diferencia excede la tolerancia de C$ ${this.TOLERANCE.toFixed(2)}.`
                );
            }

            if (!notes?.trim()) {
                throw new Error('El cierre forzado requiere una observación obligatoria.');
            }
        }

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const updatedShift = await tx.cashShift.update({
                where: { id: shiftId },
                data: {
                    endDate: new Date(),
                    endAmount,
                    difference,
                    notes: notes || 'Cuadrado'
                }
            });

            if (breakdown) {
                // Delete existing counts if any
                await tx.cashCount.deleteMany({ where: { shiftId } });

                // Create new counts
                const countData = [
                    ...breakdown.bills.map(b => ({ ...b, type: 'BILL', shiftId })),
                    ...breakdown.coins.map(c => ({ ...c, type: 'COIN', shiftId })),
                    ...(breakdown.usdBills || []).map(c => ({ ...c, type: 'USD_BILL', shiftId }))
                ].filter(c => c.count > 0);

                if (countData.length > 0) {
                    await tx.cashCount.createMany({
                        data: countData
                    });
                }
            }

            return updatedShift;
        });
    }

    /**
     * Get shift report for printing/export
     */
    static async generateShiftReport(shiftId: number, companyId: number) {
        const details = await this.getShiftDetails(shiftId, companyId);

        return {
            ...details,
            report: {
                title: 'REPORTE DE CIERRE DE CAJA',
                generatedAt: new Date().toISOString(),
                summary: `
                    Caja: ${details.shift.cashRegister}
                    Cajero: ${details.shift.user}
                    Inicio: ${details.shift.startDate}
                    Cierre: ${details.shift.endDate || 'Pendiente'}
                    
                    RESUMEN:
                    Monto Inicial: C$ ${details.amounts.startAmount.toFixed(2)}
                    Total Entradas: C$ ${details.amounts.totalIn.toFixed(2)}
                    Total Salidas: C$ ${details.amounts.totalOut.toFixed(2)}
                    Esperado: C$ ${details.amounts.expectedEndAmount.toFixed(2)}
                    Contado: C$ ${details.amounts.actualEndAmount?.toFixed(2) || 'N/A'}
                    Diferencia: C$ ${details.amounts.difference?.toFixed(2) || 'N/A'}
                `.trim()
            }
        };
    }
}
