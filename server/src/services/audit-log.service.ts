import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';

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
    private static asJson(details?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
        return details as Prisma.InputJsonValue | undefined;
    }

    static async log(entry: AuditLogEntry) {
        return prisma.auditLog.create({
            data: {
                companyId: entry.companyId,
                userId: entry.userId,
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                details: AuditLogService.asJson(entry.details),
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
                details: AuditLogService.asJson(e.details),
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
