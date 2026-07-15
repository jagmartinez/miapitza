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
                OR: [
                    { createdAt: { gte: startDate, lte: endDate } },
                    { status: 'REVERSED', reversedAt: { gte: startDate, lte: endDate } }
                ],
                order: {
                    companyId,
                    ...(branchId ? { branchId } : {})
                }
            },
            select: {
                id: true,
                amount: true,
                status: true,
                createdAt: true,
                reversedAt: true,
                methodType: true
            }
        });
        const cateringPayments = await prisma.cateringPayment.findMany({
            where: {
                OR: [
                    { date: { gte: startDate, lte: endDate } },
                    { status: 'REVERSED', reversedAt: { gte: startDate, lte: endDate } }
                ],
                event: {
                    companyId,
                    ...(branchId ? { branchId } : {})
                }
            },
            select: {
                id: true,
                amount: true,
                status: true,
                date: true,
                reversedAt: true,
                methodType: true
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

        const refundLedgerCents = new Map<string, number>();
        for (const payment of payments) {
            if (payment.status === 'REVERSED' && payment.methodType === 'CASH') {
                refundLedgerCents.set(`REV-PAY-${payment.id}`, Math.round(Number(payment.amount) * 100));
            }
        }
        for (const payment of cateringPayments) {
            if (payment.status === 'REVERSED' && payment.methodType === 'CASH') {
                refundLedgerCents.set(`REV-CAT-PAY-${payment.id}`, Math.round(Number(payment.amount) * 100));
            }
        }

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
                    shiftCashOut += amount;
                    // Refunds are already represented by the immutable payment
                    // reversal ledger. Excluding their compensating cash OUT here
                    // prevents subtracting the same reversal twice from netSales.
                    const movementCents = Math.round(amount * 100);
                    const isPaymentRefund = movement.reference !== null
                        && movement.reference !== undefined
                        && refundLedgerCents.get(movement.reference) === movementCents;
                    if (!isPaymentRefund) totalExpenses += amount;
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
        const inPeriod = (value: Date | null | undefined) => Boolean(
            value && value >= startDate && value <= endDate
        );
        const ledger = [
            ...payments.map((payment) => ({
                source: 'pos' as const,
                amount: payment.amount,
                status: payment.status,
                collectedAt: payment.createdAt,
                reversedAt: payment.reversedAt,
                methodType: payment.methodType
            })),
            ...cateringPayments.map((payment) => ({
                source: 'catering' as const,
                amount: payment.amount,
                status: payment.status,
                collectedAt: payment.date,
                reversedAt: payment.reversedAt,
                methodType: payment.methodType
            }))
        ];
        const centsFor = (rows: typeof ledger, mode: 'gross' | 'refund') => rows
            .filter((payment) => mode === 'gross'
                ? inPeriod(payment.collectedAt)
                : payment.status === 'REVERSED' && inPeriod(payment.reversedAt))
            .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
        const grossCollectedCents = centsFor(ledger, 'gross');
        const refundedCents = centsFor(ledger, 'refund');
        const grossCollected = grossCollectedCents / 100;
        const refunded = refundedCents / 100;
        totalSales = (grossCollectedCents - refundedCents) / 100;
        for (const payment of ledger) {
            const grossAmount = inPeriod(payment.collectedAt) ? Number(payment.amount) : 0;
            const refundAmount = payment.status === 'REVERSED' && inPeriod(payment.reversedAt)
                ? Number(payment.amount)
                : 0;
            const amount = grossAmount - refundAmount;
            if (payment.methodType === 'CARD') totalsByMethod.card += amount;
            else if (payment.methodType === 'BANK_TRANSFER') totalsByMethod.transfer += amount;
            else if (payment.methodType === 'CASH') totalsByMethod.cash += amount;
            else totalsByMethod.other += amount;
        }
        for (const method of Object.keys(totalsByMethod)) {
            totalsByMethod[method] = Math.round(totalsByMethod[method] * 100) / 100;
        }

        // Reconcile like-for-like: expected cash (start + cash IN - cash OUT, per shift)
        // versus the cash actually counted/closed (shift endAmounts), over the same
        // set of shifts. Payment totals by method are reported separately as sales
        // context, not used as the cash comparison population.
        const expectedCash = Math.round(totalExpectedCash * 100) / 100;
        const countedCash = Math.round(totalCash * 100) / 100;
        const cashDifference = countedCash - expectedCash;
        const overallStatus = this.calculateReconciliationStatus(cashDifference, tolerance);
        const sourceTotals = Object.fromEntries((['pos', 'catering'] as const).map((source) => {
            const rows = ledger.filter((payment) => payment.source === source);
            const grossCents = centsFor(rows, 'gross');
            const refundCents = centsFor(rows, 'refund');
            return [source, {
                grossCollected: grossCents / 100,
                refunded: refundCents / 100,
                netCollected: (grossCents - refundCents) / 100
            }];
        }));

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
                bySource: sourceTotals,
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
        const rawAmount = Number(data.amount);
        const amountCents = Math.round(rawAmount * 100);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error('El monto del depósito debe ser mayor a cero');
        if (Math.abs(rawAmount - amountCents / 100) > 1e-9) {
            throw new Error('El monto del depósito debe tener como máximo dos decimales');
        }
        const amount = amountCents / 100;
        const date = new Date(data.date);
        const reference = data.reference?.trim();
        const bankAccount = data.bankAccount?.trim();
        const requestedShiftIds = data.shiftIds || [];
        if (requestedShiftIds.some((id) => !Number.isInteger(id) || id <= 0)) {
            throw new Error('Los identificadores de turno deben ser enteros positivos');
        }
        const shiftIds = Array.from(new Set(requestedShiftIds));
        if (branchId !== undefined && shiftIds.length === 0) {
            throw new Error('Un depósito restringido a sucursal debe asociar al menos un turno cerrado');
        }

        if (Number.isNaN(date.getTime())) throw new Error('La fecha del depósito no es válida');
        if (!reference) throw new Error('La referencia del depósito es obligatoria');
        if (!bankAccount) throw new Error('La cuenta bancaria es obligatoria');
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);

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
                    select: {
                        id: true,
                        endAmount: true,
                        depositLinks: { where: { deposit: { status: 'ACTIVE' } }, select: { id: true } }
                    }
                });
                if (shifts.length !== shiftIds.length) throw new Error('Uno o más turnos no existen, pertenecen a otra empresa o continúan abiertos');
                if (shifts.some((shift) => shift.depositLinks.length > 0)) throw new Error('Uno o más turnos ya están conciliados con un depósito activo');
                const linkedAmountCents = shifts.reduce(
                    (sum, shift) => sum + Math.round(Number(shift.endAmount) * 100),
                    0
                );
                const toleranceCents = Math.round(tolerance * 100);
                const linkedAmount = linkedAmountCents / 100;
                if (Math.abs(linkedAmountCents - amountCents) > toleranceCents) {
                    throw new Error(
                        `El depósito (${amount.toFixed(2)}) no coincide con el efectivo contado de los turnos (${linkedAmount.toFixed(2)})`
                    );
                }
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
        const tolerance = await SettingService.getCashReconciliationTolerance(companyId);

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`BankDeposit\` WHERE companyId = ${companyId} AND reference = ${reference} FOR UPDATE`;
            const deposit = await tx.bankDeposit.findFirst({
                where: { companyId, reference, status: 'ACTIVE' },
                select: {
                    id: true,
                    amount: true,
                    shifts: { select: { shiftId: true, shift: { select: { endAmount: true } } } }
                }
            });
            if (!deposit) throw new Error('Depósito activo no encontrado para esta empresa');
            for (const shiftId of [...uniqueShiftIds].sort((a, b) => a - b)) {
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${shiftId} AND companyId = ${companyId} FOR UPDATE`;
            }
            const shifts = await tx.cashShift.findMany({
                where: {
                    id: { in: uniqueShiftIds }, companyId, endDate: { not: null },
                    ...(branchId ? { cashRegister: { branchId } } : {})
                },
                select: {
                    id: true,
                    endAmount: true,
                    depositLinks: { where: { deposit: { status: 'ACTIVE' } }, select: { id: true } }
                }
            });
            if (shifts.length !== uniqueShiftIds.length) throw new Error('Uno o más turnos no existen, pertenecen a otra empresa o continúan abiertos');
            if (shifts.some((shift) => shift.depositLinks.length > 0)) throw new Error('Uno o más turnos ya están conciliados');
            const existingShiftIds = new Set(deposit.shifts.map((link) => link.shiftId));
            const existingAmountCents = deposit.shifts.reduce(
                (sum, link) => sum + Math.round(Number(link.shift.endAmount) * 100),
                0
            );
            const selectedAmountCents = shifts
                .filter((shift) => !existingShiftIds.has(shift.id))
                .reduce((sum, shift) => sum + Math.round(Number(shift.endAmount) * 100), 0);
            const linkedAmountCents = existingAmountCents + selectedAmountCents;
            const linkedAmount = linkedAmountCents / 100;
            const depositAmountCents = Math.round(Number(deposit.amount) * 100);
            const toleranceCents = Math.round(tolerance * 100);
            if (Math.abs(linkedAmountCents - depositAmountCents) > toleranceCents) {
                throw new Error(
                    `El depósito (${Number(deposit.amount).toFixed(2)}) no coincide con el efectivo contado de los turnos (${linkedAmount.toFixed(2)})`
                );
            }
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
