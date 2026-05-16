import prisma from '../utils/prisma';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'TRANSFER' | 'LOGIN' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'PERMISSION_CHANGE';

export interface AuditLogEntry {
    companyId: number;
    userId: number;
    entityType: string;
    entityId: number;
    action: AuditAction;
    details?: Record<string, unknown>;
}

export class AuditLogService {
    static async log(entry: AuditLogEntry) {
        return prisma.auditLog.create({
            data: {
                companyId: entry.companyId,
                userId: entry.userId,
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                details: entry.details ?? undefined,
            },
        });
    }

    static async logBatch(entries: AuditLogEntry[]) {
        if (entries.length === 0) return;
        return prisma.auditLog.createMany({
            data: entries.map(e => ({
                companyId: e.companyId,
                userId: e.userId,
                entityType: e.entityType,
                entityId: e.entityId,
                action: e.action,
                details: e.details ?? undefined,
            })),
        });
    }

    static buildDiff(oldData: Record<string, unknown>, newData: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(newData)) {
            if (newData[key] !== undefined && oldData[key] !== newData[key]) {
                diff[key] = { from: oldData[key], to: newData[key] };
            }
        }
        return diff;
    }
}
