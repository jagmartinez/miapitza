import prisma from '../utils/prisma';
import { formatCurrency } from '../utils/currency';

/**
 * Thrown by endpoints whose backing persistence does not yet exist. Routes map
 * this to HTTP 501 Not Implemented so callers are not given a fake success.
 */
export class NotImplementedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NotImplementedError';
    }
}

/**
 * Bank Reconciliation Service
 * Handles matching cash register totals with bank deposits
 */
export class BankReconciliationService {
    // Tolerances for treating a cash difference as "balanced". These are reasonable
    // defaults; ideally they would become per-company configuration (e.g. a Setting).
    private static readonly OVERALL_TOLERANCE_RATIO = 0.005; // 0.5% of expected cash
    private static readonly OVERALL_TOLERANCE_MAX = 1.0; // or $1, whichever is smaller
    private static readonly SHIFT_TOLERANCE = 0.5; // per-shift variance tolerance

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

        // Reconcile like-for-like: expected cash (start + cash IN - cash OUT, per shift)
        // versus the cash actually counted/closed (shift endAmounts), over the same
        // set of shifts. Payment totals by method are reported separately as sales
        // context, not used as the cash comparison population.
        const expectedCash = Math.round(totalExpectedCash * 100) / 100;
        const countedCash = Math.round(totalCash * 100) / 100;
        const cashDifference = countedCash - expectedCash;
        const overallStatus = this.calculateReconciliationStatus(cashDifference, expectedCash);

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
    static async recordDeposit(_companyId: number, _data: {
        date: Date;
        amount: number;
        bankAccount: string;
        reference: string;
        notes?: string;
        shiftIds?: number[];
    }): Promise<never> {
        // There is no BankDeposit model in the schema yet, so we cannot persist a
        // deposit. Rather than fabricate a success response (which previously returned
        // a fake `id: Date.now()`), surface this clearly as not implemented. The route
        // maps NotImplementedError to HTTP 501.
        throw new NotImplementedError(
            'El registro de depósitos bancarios no está implementado: falta el modelo BankDeposit en la base de datos.'
        );
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
    static async markAsReconciled(companyId: number, shiftIds: number[], depositReference: string) {
        // Scope by companyId so a tenant can never reconcile another tenant's shifts.
        const result = await prisma.cashShift.updateMany({
            where: {
                id: { in: shiftIds },
                companyId
            },
            data: {
                notes: `RECONCILED - Depósito: ${depositReference}`
            }
        });

        return {
            reconciled: result.count,
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
        const tolerance = Math.min(expected * this.OVERALL_TOLERANCE_RATIO, this.OVERALL_TOLERANCE_MAX);
        if (absDiff <= tolerance) return 'RECONCILED';
        if (difference > 0) return 'SURPLUS';
        return 'DEFICIT';
    }

    /**
     * Calculate individual shift status based on cash variance.
     */
    private static calculateShiftStatus(variance: number): string {
        const absVariance = Math.abs(variance);
        if (absVariance <= this.SHIFT_TOLERANCE) return 'BALANCED';
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
