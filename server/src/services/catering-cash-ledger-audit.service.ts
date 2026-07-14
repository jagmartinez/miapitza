import prisma from '../utils/prisma';

export interface CateringCashLedgerAnomaly {
    paymentId: number;
    eventId: number;
    companyId: number;
    branchId: number;
    code: 'MISSING_IN' | 'DUPLICATE_IN' | 'INVALID_IN' | 'MISSING_OUT' | 'DUPLICATE_OUT' | 'INVALID_OUT' | 'UNEXPECTED_OUT';
    message: string;
}

export class CateringCashLedgerAuditService {
    static async audit(companyId?: number): Promise<CateringCashLedgerAnomaly[]> {
        const payments = await prisma.cateringPayment.findMany({
            where: {
                methodType: 'CASH',
                ...(companyId ? { event: { companyId } } : {})
            },
            select: {
                id: true,
                cateringEventId: true,
                amount: true,
                status: true,
                event: { select: { companyId: true, branchId: true } }
            }
        });
        if (payments.length === 0) return [];

        const references = payments.flatMap((payment) => [
            `CAT-PAY-${payment.id}`,
            `REV-CAT-PAY-${payment.id}`
        ]);
        const movements = await prisma.cashMovement.findMany({
            where: { reference: { in: references } },
            select: {
                id: true,
                type: true,
                amount: true,
                reference: true,
                shift: {
                    select: {
                        companyId: true,
                        cashRegister: { select: { branchId: true } }
                    }
                }
            }
        });

        const anomalies: CateringCashLedgerAnomaly[] = [];
        for (const payment of payments) {
            const expectedCents = Math.round(Number(payment.amount) * 100);
            const base = {
                paymentId: payment.id,
                eventId: payment.cateringEventId,
                companyId: payment.event.companyId,
                branchId: payment.event.branchId
            };
            const inspect = (kind: 'IN' | 'OUT') => {
                const reference = kind === 'IN' ? `CAT-PAY-${payment.id}` : `REV-CAT-PAY-${payment.id}`;
                const matches = movements.filter((movement) => movement.reference === reference);
                const valid = matches.filter((movement) =>
                    movement.type === kind
                    &&
                    Math.round(Number(movement.amount) * 100) === expectedCents
                    && movement.shift.companyId === payment.event.companyId
                    && movement.shift.cashRegister.branchId === payment.event.branchId
                );
                return { matches, valid };
            };

            const inbound = inspect('IN');
            if (inbound.matches.length === 0) {
                anomalies.push({ ...base, code: 'MISSING_IN', message: 'Falta CAT-PAY de entrada para el pago en efectivo' });
            } else if (inbound.matches.length > 1) {
                anomalies.push({ ...base, code: 'DUPLICATE_IN', message: 'Hay más de una entrada CAT-PAY para el mismo pago' });
            } else if (inbound.valid.length !== 1) {
                anomalies.push({ ...base, code: 'INVALID_IN', message: 'La entrada CAT-PAY no coincide en monto, empresa o sucursal' });
            }

            const outbound = inspect('OUT');
            if (payment.status === 'REVERSED') {
                if (outbound.matches.length === 0) {
                    anomalies.push({ ...base, code: 'MISSING_OUT', message: 'Falta REV-CAT-PAY para un pago revertido' });
                } else if (outbound.matches.length > 1) {
                    anomalies.push({ ...base, code: 'DUPLICATE_OUT', message: 'Hay más de un reverso de caja para el mismo pago' });
                } else if (outbound.valid.length !== 1) {
                    anomalies.push({ ...base, code: 'INVALID_OUT', message: 'El REV-CAT-PAY no coincide en monto, empresa o sucursal' });
                }
            } else if (outbound.matches.length > 0) {
                anomalies.push({ ...base, code: 'UNEXPECTED_OUT', message: 'Existe un reverso de caja para un pago que sigue activo' });
            }
        }
        return anomalies;
    }

    static async assertClean(companyId?: number): Promise<void> {
        const anomalies = await this.audit(companyId);
        if (anomalies.length > 0) {
            const sample = anomalies.slice(0, 10)
                .map((anomaly) => `payment=${anomaly.paymentId} ${anomaly.code}`)
                .join(', ');
            throw new Error(
                `Catering cash ledger integrity failed with ${anomalies.length} anomaly(s): ${sample}. `
                + 'Remediate manually by identifying the historical shift and posting the missing immutable CAT-PAY/REV-CAT-PAY entry; never attach it to an inferred shift.'
            );
        }
    }
}
