import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { formatCurrency } from '../utils/currency';
import { SettingService } from './setting.service';

/**
 * Bank Reconciliation Service
 * Handles matching cash register totals with bank deposits
 */
export class BankReconciliationService {
    /**
     * Get reconciliation status for a date range
     */
    static async getReconciliationStatus(companyId: number, startDate: Date, endDate: Date, branchId?: number) {
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);
        const payments = await prisma.payment.findMany({
            where: {
                status: 'ACTIVE',
                createdAt: {
                    gte: startDate,
                    lte: endDate
                },
                order: {
                    companyId,
                    status: { not: 'CANCELLED' },
                    ...(branchId ? { branchId } : {})
                }
            },
            include: {
                paymentMethod: {
                    select: { name: true }
                }
            }
        });

        // Get all closed shifts in the period
        const shifts = await prisma.cashShift.findMany({
            where: {
                companyId,
                ...(branchId ? { cashRegister: { branchId } } : {}),
                endDate: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                cashRegister: true,
                user: { select: { name: true } },
                movements: true
            }
        });

        // Calculate totals
        const totalsByMethod: Record<string, number> = {
            cash: 0,
            card: 0,
            transfer: 0,
            other: 0
        };

        let totalSales = 0;
        let totalExpenses = 0;
        let totalCash = 0;
        let totalExpectedCash = 0;

        const shiftDetails: Array<{
            shiftId: number;
            cashRegister: string;
            user: string;
            startAmount: number;
            endAmount: number;
            salesIn: number;
            cashOut: number;
            difference: number;
            status: string;
        }> = [];

        for (const shift of shifts) {
            let shiftSalesIn = 0;
            let shiftCashOut = 0;

            for (const movement of shift.movements) {
                const amount = Number(movement.amount);
                if (movement.type === 'IN') {
                    shiftSalesIn += amount;
                } else if (movement.type === 'OUT') {
                    totalExpenses += amount;
                    shiftCashOut += amount;
                }
            }

            const endAmt = Number(shift.endAmount || 0);
            totalCash += endAmt;

            const shiftExpectedCash = Number(shift.startAmount) + shiftSalesIn - shiftCashOut;
            totalExpectedCash += shiftExpectedCash;
            const shiftDiff = endAmt - shiftExpectedCash;

            shiftDetails.push({
                shiftId: shift.id,
                cashRegister: shift.cashRegister.name,
                user: shift.user.name,
                startAmount: Number(shift.startAmount),
                endAmount: endAmt,
                salesIn: shiftSalesIn,
                cashOut: shiftCashOut,
                difference: Math.round(shiftDiff * 100) / 100,
                status: this.calculateShiftStatus(shiftDiff, tolerance)
            });
        }

        // Use registered payments as the source of truth for sales by method.
        const grossCollected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
        const refunded = payments
            .filter((payment) => payment.status === 'REVERSED')
            .reduce((sum, payment) => sum + Number(payment.amount), 0);
        totalSales = grossCollected - refunded;
        for (const payment of payments) {
            if (payment.status === 'REVERSED') continue;
            const methodName = (payment.paymentMethod?.name || '').toLowerCase();
            const amount = Number(payment.amount);
            if (methodName.includes('tarjeta') || methodName.includes('card') || methodName.includes('pos')) {
                totalsByMethod.card += amount;
            } else if (methodName.includes('transfer') || methodName.includes('transferencia')) {
                totalsByMethod.transfer += amount;
            } else if (methodName.includes('efectivo') || methodName.includes('cash')) {
                totalsByMethod.cash += amount;
            } else {
                totalsByMethod.other += amount;
            }
        }

        // Reconcile like-for-like: expected cash (start + cash IN - cash OUT, per shift)
        // versus the cash actually counted/closed (shift endAmounts), over the same
        // set of shifts. Payment totals by method are reported separately as sales
        // context, not used as the cash comparison population.
        const expectedCash = Math.round(totalExpectedCash * 100) / 100;
        const countedCash = Math.round(totalCash * 100) / 100;
        const cashDifference = countedCash - expectedCash;
        const overallStatus = this.calculateReconciliationStatus(cashDifference, tolerance);

        return {
            period: {
                start: startDate,
                end: endDate
            },
            shifts: shifts.length,
            shiftDetails,
            totals: {
                totalSales,
                grossCollected,
                refunded,
                netCollected: totalSales,
                totalExpenses,
                netSales: totalSales - totalExpenses,
                byMethod: totalsByMethod,
                cashInRegisters: totalCash
            },
            reconciliation: {
                cashExpected: expectedCash,
                cashActual: countedCash,
                difference: Math.round(cashDifference * 100) / 100,
                status: overallStatus
            }
        };
    }

    /**
     * Create bank deposit record
     */
    static async recordDeposit(companyId: number, userId: number, data: {
        date: Date | string;
        amount: number;
        bankAccount: string;
        reference: string;
        notes?: string;
        shiftIds?: number[];
    }, branchId?: number) {
        const amount = Math.round(Number(data.amount) * 100) / 100;
        const date = new Date(data.date);
        const reference = data.reference?.trim();
        const bankAccount = data.bankAccount?.trim();
        const requestedShiftIds = data.shiftIds || [];
        if (requestedShiftIds.some((id) => !Number.isInteger(id) || id <= 0)) {
            throw new Error('Los identificadores de turno deben ser enteros positivos');
        }
        const shiftIds = Array.from(new Set(requestedShiftIds));

        if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto del depósito debe ser mayor a cero');
        if (Number.isNaN(date.getTime())) throw new Error('La fecha del depósito no es válida');
        if (!reference) throw new Error('La referencia del depósito es obligatoria');
        if (!bankAccount) throw new Error('La cuenta bancaria es obligatoria');

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const actor = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            if (shiftIds.length > 0) {
                for (const shiftId of [...shiftIds].sort((a, b) => a - b)) {
                    await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shiftId} AND companyId = ${companyId} FOR UPDATE`;
                }
                const shifts = await tx.cashShift.findMany({
                    where: {
                        id: { in: shiftIds }, companyId, endDate: { not: null },
                        ...(branchId ? { cashRegister: { branchId } } : {})
                    },
                    select: { id: true, depositLinks: { where: { deposit: { status: 'ACTIVE' } }, select: { id: true } } }
                });
                if (shifts.length !== shiftIds.length) throw new Error('Uno o más turnos no existen, pertenecen a otra empresa o continúan abiertos');
                if (shifts.some((shift) => shift.depositLinks.length > 0)) throw new Error('Uno o más turnos ya están conciliados con un depósito activo');
            }

            return tx.bankDeposit.create({
                data: {
                    companyId,
                    createdById: userId,
                    date,
                    amount,
                    bankAccount,
                    reference,
                    notes: data.notes?.trim() || null,
                    shifts: shiftIds.length > 0 ? { create: shiftIds.map((shiftId) => ({ shiftId })) } : undefined
                },
                include: { shifts: { select: { shiftId: true } } }
            });
        });
    }

    /**
     * Get pending reconciliations
     */
    static async getPendingReconciliations(companyId: number, branchId?: number) {
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);
        // Get shifts without matching deposits
        const unreconciledShifts = await prisma.cashShift.findMany({
            where: {
                companyId,
                ...(branchId ? { cashRegister: { branchId } } : {}),
                endDate: { not: null },
                depositLinks: { none: { deposit: { status: 'ACTIVE' } } }
            },
            include: {
                cashRegister: true,
                user: { select: { name: true } },
                movements: true
            },
            orderBy: { endDate: 'desc' },
            take: 50
        });

        return unreconciledShifts.map((shift) => {
            const diff = Number(shift.difference || 0);
            let salesTotal = 0;
            let expensesTotal = 0;

            for (const movement of shift.movements) {
                const amount = Number(movement.amount);
                if (movement.type === 'IN') {
                    salesTotal += amount;
                } else if (movement.type === 'OUT') {
                    expensesTotal += amount;
                }
            }

            const expectedCash = Number(shift.startAmount) + salesTotal - expensesTotal;
            const actualCash = Number(shift.endAmount || 0);
            const cashVariance = Math.round((actualCash - expectedCash) * 100) / 100;

            return {
                shiftId: shift.id,
                date: shift.endDate,
                cashRegister: shift.cashRegister.name,
                user: shift.user.name,
                startAmount: Number(shift.startAmount),
                endAmount: actualCash,
                salesTotal,
                expensesTotal,
                expectedCash: Math.round(expectedCash * 100) / 100,
                cashVariance,
                closingDifference: Math.round(diff * 100) / 100,
                status: this.calculateShiftStatus(cashVariance, tolerance)
            };
        });
    }

    /**
     * Mark shifts as reconciled
     */
    static async markAsReconciled(companyId: number, shiftIds: number[], depositReference: string, branchId?: number) {
        if (shiftIds.some((id) => !Number.isInteger(id) || id <= 0)) {
            throw new Error('Los identificadores de turno deben ser enteros positivos');
        }
        const uniqueShiftIds = Array.from(new Set(shiftIds));
        const reference = depositReference.trim();
        if (uniqueShiftIds.length === 0) throw new Error('Debe seleccionar al menos un turno');
        if (!reference) throw new Error('La referencia del depósito es obligatoria');

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`BankDeposit\` WHERE companyId = ${companyId} AND reference = ${reference} FOR UPDATE`;
            const deposit = await tx.bankDeposit.findFirst({ where: { companyId, reference, status: 'ACTIVE' }, select: { id: true } });
            if (!deposit) throw new Error('Depósito activo no encontrado para esta empresa');
            for (const shiftId of [...uniqueShiftIds].sort((a, b) => a - b)) {
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shiftId} AND companyId = ${companyId} FOR UPDATE`;
            }
            const shifts = await tx.cashShift.findMany({
                where: {
                    id: { in: uniqueShiftIds }, companyId, endDate: { not: null },
                    ...(branchId ? { cashRegister: { branchId } } : {})
                },
                select: { id: true, depositLinks: { where: { deposit: { status: 'ACTIVE' } }, select: { id: true } } }
            });
            if (shifts.length !== uniqueShiftIds.length) throw new Error('Uno o más turnos no existen, pertenecen a otra empresa o continúan abiertos');
            if (shifts.some((shift) => shift.depositLinks.length > 0)) throw new Error('Uno o más turnos ya están conciliados');
            await tx.bankDepositShift.createMany({ data: uniqueShiftIds.map((shiftId) => ({ depositId: deposit.id, shiftId })) });
            return { reconciled: uniqueShiftIds.length, shiftIds: uniqueShiftIds, depositReference: reference };
        });
    }

    static async getDeposits(companyId: number, branchId?: number) {
        return prisma.bankDeposit.findMany({
            where: {
                companyId,
                ...(branchId ? {
                    shifts: {
                        some: { shift: { cashRegister: { branchId } } },
                        every: { shift: { cashRegister: { branchId } } }
                    }
                } : {})
            },
            include: {
                createdBy: { select: { id: true, name: true } },
                reversedBy: { select: { id: true, name: true } },
                shifts: { select: { shiftId: true } }
            },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            take: 100
        });
    }

    static async reverseDeposit(companyId: number, depositId: number, userId: number, reason: string, branchId?: number) {
        const reversalReason = reason.trim();
        if (!reversalReason) throw new Error('El motivo del reverso es obligatorio');
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`BankDeposit\` WHERE id = ${depositId} AND companyId = ${companyId} FOR UPDATE`;
            const actor = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!actor) throw new Error('Usuario no válido para esta empresa');
            const deposit = await tx.bankDeposit.findFirst({
                where: {
                    id: depositId,
                    companyId,
                    status: 'ACTIVE',
                    ...(branchId ? {
                        shifts: {
                            some: { shift: { cashRegister: { branchId } } },
                            every: { shift: { cashRegister: { branchId } } }
                        }
                    } : {})
                }
            });
            if (!deposit) throw new Error('Depósito activo no encontrado');
            return tx.bankDeposit.update({
                where: { id: deposit.id },
                data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId, reversalReason }
            });
        });
    }

    /**
     * Calculate reconciliation status based on the difference and expected amount.
     * Allows a small tolerance (0.5% of expected or max $1) for rounding differences.
     */
    private static calculateReconciliationStatus(difference: number, tolerance: number): string {
        const absDiff = Math.abs(difference);
        if (absDiff === 0) return 'RECONCILED';

        // Tolerance: 0.5% of expected cash or $1, whichever is smaller
        if (absDiff <= tolerance) return 'RECONCILED';
        if (difference > 0) return 'SURPLUS';
        return 'DEFICIT';
    }

    /**
     * Calculate individual shift status based on cash variance.
     */
    private static calculateShiftStatus(variance: number, tolerance: number): string {
        const absVariance = Math.abs(variance);
        if (absVariance <= tolerance) return 'BALANCED';
        if (variance > 0) return 'SURPLUS';
        return 'DEFICIT';
    }

    /**
     * Generate reconciliation report
     */
    static async generateReport(companyId: number, month: number, year: number, branchId?: number) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const status = await this.getReconciliationStatus(companyId, startDate, endDate, branchId);

        return {
            ...status,
            report: {
                title: `Reporte de Conciliación - ${month}/${year}`,
                generatedAt: new Date().toISOString(),
                summary: `
                    Período: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}
                    Total de Turnos: ${status.shifts}
                    
                    VENTAS POR MÉTODO:
                    Efectivo: ${formatCurrency(status.totals.byMethod.cash, {})}
                    Tarjeta: ${formatCurrency(status.totals.byMethod.card, {})}
                    Transferencia: ${formatCurrency(status.totals.byMethod.transfer, {})}
                    
                    CONCILIACIÓN:
                    Efectivo Esperado: ${formatCurrency(status.reconciliation.cashExpected, {})}
                    Efectivo en Caja: ${formatCurrency(status.reconciliation.cashActual, {})}
                    Diferencia: ${formatCurrency(status.reconciliation.difference, {})}
                    Estado: ${status.reconciliation.status}
                `.trim()
            }
        };
    }
}
