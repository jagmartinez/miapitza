import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { SettingService } from './setting.service';

/**
 * Cash Register Arqueo Service
 * Detailed cash counting and reconciliation
 */
export class CashArqueoService {
    // Acceptable cash count difference (in córdobas) before a shift is flagged.
    private static calculateCountedAmount(breakdown: {
        bills?: { denomination: number; count: number }[];
        coins?: { denomination: number; count: number }[];
        usdBills?: { denomination: number; count: number }[];
        exchangeRate?: number;
    }) {
        const rows = [...(breakdown.bills || []), ...(breakdown.coins || []), ...(breakdown.usdBills || [])];
        if (rows.some((row) => !Number.isFinite(row.denomination) || row.denomination <= 0 || !Number.isInteger(row.count) || row.count < 0)) {
            throw new Error('El desglose contiene denominaciones o cantidades inválidas');
        }
        if (breakdown.exchangeRate !== undefined && (!Number.isFinite(breakdown.exchangeRate) || breakdown.exchangeRate < 0)) {
            throw new Error('La tasa de cambio no es válida');
        }
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
            totalCounted: Math.round((billsTotal + coinsTotal + usdInCordobas) * 100) / 100
        };
    }

    private static classifyDifference(difference: number, tolerance: number) {
        const absoluteDifference = Math.abs(difference);
        return {
            difference,
            absoluteDifference,
            status: difference === 0 ? 'CUADRADO' : (difference > 0 ? 'SOBRANTE' : 'FALTANTE'),
            withinTolerance: absoluteDifference <= tolerance,
            requiresNote: absoluteDifference > 0 && absoluteDifference <= tolerance,
            exceedsTolerance: absoluteDifference > tolerance,
            tolerance
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
        const actualEndAmount = shift.endAmount !== null ? Number(shift.endAmount) : null;
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
        if (!Number.isFinite(closeData.endAmount) || Number(closeData.endAmount) < 0) {
            throw new Error('El monto contado debe ser un número finito mayor o igual a cero');
        }
        const details = await this.getShiftDetails(shiftId, companyId);
        const counted = this.calculateCountedAmount(closeData);
        const endAmount = closeData.endAmount ?? counted.totalCounted;
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);
        const differenceSummary = this.classifyDifference(endAmount - details.amounts.expectedEndAmount, tolerance);

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
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);
        const differenceSummary = this.classifyDifference(counted.totalCounted - details.amounts.expectedEndAmount, tolerance);

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
            bills?: { denomination: number; count: number }[];
            coins?: { denomination: number; count: number }[];
            usdBills?: { denomination: number; count: number }[];
            exchangeRate?: number;
        },
        options?: {
            forceClose?: boolean;
        }
    ) {
        if (!Number.isFinite(endAmount) || endAmount < 0) {
            throw new Error('El monto de cierre debe ser un número finito mayor o igual a cero');
        }
        const normalizedEndAmount = Math.round(endAmount * 100) / 100;
        const preview = await this.previewClose(shiftId, companyId, {
            endAmount: normalizedEndAmount,
            notes,
            bills: breakdown?.bills,
            coins: breakdown?.coins,
            usdBills: breakdown?.usdBills,
            exchangeRate: breakdown?.exchangeRate
        });
        const difference = preview.difference;
        const isAdminOverride = actorRoles.some((role) => role === 'ADMIN' || role === 'SUPERADMIN');
        const currencySymbol = await SettingService.getCurrencySymbol(companyId);

        if (preview.requiresNote && !notes?.trim()) {
            throw new Error('Debe agregar una observación cuando exista diferencia dentro de tolerancia.');
        }

        if (preview.exceedsTolerance) {
            if (!(options?.forceClose && isAdminOverride)) {
                const diffType = difference > 0 ? 'sobrante' : 'faltante';
                const diffAmount = Math.abs(difference).toFixed(2);
                throw new Error(
                    `No se puede cerrar el turno con ${diffType} de ${currencySymbol} ${diffAmount}. ` +
                    `La diferencia excede la tolerancia de ${currencySymbol} ${preview.tolerance.toFixed(2)}.`
                );
            }

            if (!notes?.trim()) {
                throw new Error('El cierre forzado requiere una observación obligatoria.');
            }
        }

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shiftId} AND companyId = ${companyId} FOR UPDATE`;
            const lockedShift = await tx.cashShift.findFirst({
                where: { id: shiftId, companyId },
                include: { movements: { select: { type: true, amount: true } } }
            });
            if (!lockedShift) throw new Error('Turno de caja no encontrado');
            if (lockedShift.endDate) throw new Error('El turno de caja ya está cerrado');

            const expectedNow = Number(lockedShift.startAmount) + lockedShift.movements.reduce(
                (sum, movement) => sum + (movement.type === 'IN' ? Number(movement.amount) : -Number(movement.amount)),
                0
            );
            const expectedNowCents = Math.round(expectedNow * 100);
            const currentSummary = this.classifyDifference(
                (Math.round(normalizedEndAmount * 100) - expectedNowCents) / 100,
                preview.tolerance
            );
            if (currentSummary.requiresNote && !notes?.trim()) throw new Error('Debe agregar una observación cuando exista diferencia dentro de tolerancia.');
            if (currentSummary.exceedsTolerance && !(options?.forceClose && isAdminOverride)) {
                throw new Error(`No se puede cerrar el turno: la diferencia de ${currencySymbol} ${Math.abs(currentSummary.difference).toFixed(2)} excede la tolerancia.`);
            }
            if (currentSummary.exceedsTolerance && !notes?.trim()) throw new Error('El cierre forzado requiere una observación obligatoria.');

            const updatedShift = await tx.cashShift.update({
                where: { id: shiftId },
                data: {
                    endDate: new Date(),
                    endAmount: normalizedEndAmount,
                    difference: currentSummary.difference,
                    notes: notes || 'Cuadrado'
                }
            });

            if (breakdown) {
                // Delete existing counts if any
                await tx.cashCount.deleteMany({ where: { shiftId } });

                // Create new counts
                const countData = [
                    ...(breakdown.bills || []).map(b => ({ ...b, type: 'BILL', shiftId })),
                    ...(breakdown.coins || []).map(c => ({ ...c, type: 'COIN', shiftId })),
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
        const currencySymbol = await SettingService.getCurrencySymbol(companyId);

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
                    Monto Inicial: ${currencySymbol} ${details.amounts.startAmount.toFixed(2)}
                    Total Entradas: ${currencySymbol} ${details.amounts.totalIn.toFixed(2)}
                    Total Salidas: ${currencySymbol} ${details.amounts.totalOut.toFixed(2)}
                    Esperado: ${currencySymbol} ${details.amounts.expectedEndAmount.toFixed(2)}
                    Contado: ${currencySymbol} ${details.amounts.actualEndAmount?.toFixed(2) || 'N/A'}
                    Diferencia: ${currencySymbol} ${details.amounts.difference?.toFixed(2) || 'N/A'}
                `.trim()
            }
        };
    }
}
