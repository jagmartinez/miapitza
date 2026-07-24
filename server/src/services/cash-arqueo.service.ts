import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { SettingService } from './setting.service';
import {
    CashMovementReportService,
    summarizeCashMovements
} from './cash-movement-report.service';

/**
 * Cash Register Arqueo Service
 * Detailed cash counting and reconciliation
 */
export class CashArqueoService {
    private static hasPhysicalBreakdown(breakdown?: {
        bills?: { denomination: number; count: number }[];
        coins?: { denomination: number; count: number }[];
        usdBills?: { denomination: number; count: number }[];
    }): boolean {
        return breakdown !== undefined
            && (
                Array.isArray(breakdown.bills)
                || Array.isArray(breakdown.coins)
                || Array.isArray(breakdown.usdBills)
            );
    }

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
        // USD counted at rate 0 silently understates the arqueo — fail closed.
        if (usdTotal > 0 && (!Number.isFinite(breakdown.exchangeRate) || Number(breakdown.exchangeRate) <= 0)) {
            throw new Error('Debe indicar una tasa de cambio mayor a cero cuando hay billetes en USD');
        }
        const exchangeRate = usdTotal > 0 ? Number(breakdown.exchangeRate) : (breakdown.exchangeRate || 0);
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
                        name: true,
                        branchId: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                closedBy: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                movements: {
                    orderBy: { createdAt: 'desc' },
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

        const enrichedMovements = await CashMovementReportService.enrichForReport(
            shift.movements,
            companyId,
            shift.cashRegister.branchId
        );
        const inMovements = enrichedMovements.filter((movement) => movement.type === 'IN');
        const outMovements = enrichedMovements.filter((movement) => movement.type === 'OUT');
        const movementSummary = summarizeCashMovements(shift.movements);

        // Calculate expected vs actual
        const startAmountCents = Math.round(Number(shift.startAmount) * 100);
        const expectedEndAmountCents = startAmountCents
            + Math.round(movementSummary.totalIn * 100)
            - Math.round(movementSummary.totalOut * 100);
        const expectedEndAmount = expectedEndAmountCents / 100;
        const actualEndAmount = shift.endAmount !== null ? Number(shift.endAmount) : null;
        const difference = actualEndAmount !== null
            ? (Math.round(actualEndAmount * 100) - expectedEndAmountCents) / 100
            : null;

        return {
            shift: {
                id: shift.id,
                cashRegister: shift.cashRegister.name,
                user: shift.user.name,
                startDate: shift.startDate,
                endDate: shift.endDate,
                closedBy: shift.closedBy,
                forceClosed: shift.forceClosed,
                closingExchangeRate: shift.closingExchangeRate !== null
                    ? Number(shift.closingExchangeRate)
                    : null,
                status: shift.endDate ? 'CERRADO' : 'ABIERTO'
            },
            amounts: {
                startAmount: Number(shift.startAmount),
                expectedEndAmount,
                actualEndAmount,
                difference,
                ...movementSummary
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
        const counted = this.calculateCountedAmount(closeData);
        const endAmount = Number(closeData.endAmount);
        if (
            this.hasPhysicalBreakdown(closeData)
            && Math.round(endAmount * 100) !== Math.round(counted.totalCounted * 100)
        ) {
            throw new Error(
                `El monto contado (${endAmount.toFixed(2)}) no coincide con el total de denominaciones (${counted.totalCounted.toFixed(2)})`
            );
        }
        const details = await this.getShiftDetails(shiftId, companyId);
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
        actorId: number,
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
        if (!Number.isInteger(actorId) || actorId <= 0) {
            throw new Error('El actor de cierre no es válido');
        }
        const normalizedEndAmount = Math.round(endAmount * 100) / 100;
        const hasPhysicalBreakdown = this.hasPhysicalBreakdown(breakdown);
        const preview = await this.previewClose(shiftId, companyId, {
            endAmount: normalizedEndAmount,
            notes,
            bills: hasPhysicalBreakdown ? breakdown?.bills : undefined,
            coins: hasPhysicalBreakdown ? breakdown?.coins : undefined,
            usdBills: hasPhysicalBreakdown ? breakdown?.usdBills : undefined,
            exchangeRate: hasPhysicalBreakdown ? breakdown?.exchangeRate : undefined
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

            const expectedNowCents = Math.round(Number(lockedShift.startAmount) * 100)
                + lockedShift.movements.reduce(
                    (sum, movement) => sum + (
                        movement.type === 'IN'
                            ? Math.round(Number(movement.amount) * 100)
                            : -Math.round(Number(movement.amount) * 100)
                    ),
                    0
                );
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
                    closedById: actorId,
                    forceClosed: currentSummary.exceedsTolerance
                        && options?.forceClose === true
                        && isAdminOverride,
                    closingExchangeRate: hasPhysicalBreakdown && preview.countedBreakdown.usdBills > 0
                        ? preview.countedBreakdown.exchangeRate
                        : null,
                    notes: notes || 'Cuadrado'
                }
            });

            if (hasPhysicalBreakdown && breakdown) {
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
