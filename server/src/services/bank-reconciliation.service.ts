import prisma from '../utils/prisma';
import { formatCurrency } from '../utils/currency';

/**
 * Bank Reconciliation Service
 * Handles matching cash register totals with bank deposits
 */
export class BankReconciliationService {
    /**
     * Get reconciliation status for a date range
     */
    static async getReconciliationStatus(companyId: number, startDate: Date, endDate: Date) {
        const payments = await prisma.payment.findMany({
            where: {
                order: {
                    companyId,
                    status: 'PAID',
                    OR: [
                        {
                            closedAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        },
                        {
                            closedAt: null,
                            createdAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        }
                    ]
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
                status: this.calculateShiftStatus(shiftDiff)
            });
        }

        // Use registered payments as the source of truth for sales by method.
        totalSales = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
        for (const payment of payments) {
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

        const cashDifference = totalCash - totalsByMethod.cash;
        const overallStatus = this.calculateReconciliationStatus(cashDifference, totalsByMethod.cash);

        return {
            period: {
                start: startDate,
                end: endDate
            },
            shifts: shifts.length,
            shiftDetails,
            totals: {
                totalSales,
                totalExpenses,
                netSales: totalSales - totalExpenses,
                byMethod: totalsByMethod,
                cashInRegisters: totalCash
            },
            reconciliation: {
                cashExpected: totalsByMethod.cash,
                cashActual: totalCash,
                difference: Math.round(cashDifference * 100) / 100,
                status: overallStatus
            }
        };
    }

    /**
     * Create bank deposit record
     */
    static async recordDeposit(companyId: number, data: {
        date: Date;
        amount: number;
        bankAccount: string;
        reference: string;
        notes?: string;
        shiftIds?: number[];
    }) {
        // This would normally create a record in a BankDeposit table
        // For now, returning a simulated response
        return {
            id: Date.now(),
            companyId,
            date: data.date,
            amount: data.amount,
            bankAccount: data.bankAccount,
            reference: data.reference,
            notes: data.notes,
            status: 'PENDING_VERIFICATION',
            linkedShifts: data.shiftIds || [],
            createdAt: new Date()
        };
    }

    /**
     * Get pending reconciliations
     */
    static async getPendingReconciliations(companyId: number) {
        // Get shifts without matching deposits
        const unreconciledShifts = await prisma.cashShift.findMany({
            where: {
                companyId,
                endDate: { not: null },
                OR: [
                    { notes: null },
                    { notes: { not: { contains: 'RECONCILED' } } }
                ]
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
                status: this.calculateShiftStatus(cashVariance)
            };
        });
    }

    /**
     * Mark shifts as reconciled
     */
    static async markAsReconciled(shiftIds: number[], depositReference: string) {
        const results = await Promise.all(
            shiftIds.map(id =>
                prisma.cashShift.update({
                    where: { id },
                    data: {
                        notes: `RECONCILED - Depósito: ${depositReference}`
                    }
                })
            )
        );

        return {
            reconciled: results.length,
            shiftIds,
            depositReference
        };
    }

    /**
     * Calculate reconciliation status based on the difference and expected amount.
     * Allows a small tolerance (0.5% of expected or max $1) for rounding differences.
     */
    private static calculateReconciliationStatus(difference: number, expected: number): string {
        const absDiff = Math.abs(difference);
        if (absDiff === 0) return 'RECONCILED';

        // Tolerance: 0.5% of expected cash or $1, whichever is smaller
        const tolerance = Math.min(expected * 0.005, 1.0);
        if (absDiff <= tolerance) return 'RECONCILED';
        if (difference > 0) return 'SURPLUS';
        return 'DEFICIT';
    }

    /**
     * Calculate individual shift status based on cash variance.
     */
    private static calculateShiftStatus(variance: number): string {
        const absVariance = Math.abs(variance);
        if (absVariance <= 0.50) return 'BALANCED';
        if (variance > 0) return 'SURPLUS';
        return 'DEFICIT';
    }

    /**
     * Generate reconciliation report
     */
    static async generateReport(companyId: number, month: number, year: number) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const status = await this.getReconciliationStatus(companyId, startDate, endDate);

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
