import crypto from 'crypto';
import type { OperationalDevice, OperationalDeviceType } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';
import { SessionService } from './session.service';

export class OperationalDeviceError extends Error {
    constructor(message: string, public statusCode: number) {
        super(message);
        this.name = 'OperationalDeviceError';
    }
}

export interface DeviceActor {
    userId: number;
    companyId: number;
}

export interface RegisterDeviceInput {
    branchId: number;
    type: OperationalDeviceType;
    name: string;
    kitchenUserId?: number;
}

/** Session tag stored in `UserSession.device` for sessions opened from a device. */
export function deviceSessionTag(deviceId: number): string {
    return `op-device:${deviceId}`;
}

function hashDeviceToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export class OperationalDeviceService {
    /**
     * Registers a tablet. The raw token is returned once and never persisted or
     * logged; only its sha256 hex digest is stored.
     */
    static async register(
        actor: DeviceActor,
        input: RegisterDeviceInput,
    ): Promise<{ device: OperationalDevice; deviceToken: string }> {
        const name = String(input.name ?? '').trim();
        if (!name || name.length > 100) {
            throw new OperationalDeviceError('Nombre de dispositivo inválido', 400);
        }

        const branch = await prisma.branch.findFirst({
            where: { id: input.branchId, companyId: actor.companyId },
            select: { id: true },
        });
        if (!branch) throw new OperationalDeviceError('Sucursal no encontrada', 404);

        let kitchenUserId: number | null = null;
        if (input.type === 'KITCHEN_TABLET') {
            if (!input.kitchenUserId) {
                throw new OperationalDeviceError('Usuario de cocina inválido', 400);
            }
            const kitchenUser = await prisma.user.findFirst({
                where: {
                    id: input.kitchenUserId,
                    companyId: actor.companyId,
                    status: 'ACTIVE',
                    // The kitchen account is fixed per branch.
                    branchId: branch.id,
                    OR: [
                        { role: { name: 'COCINA' } },
                        { userRoles: { some: { role: { name: 'COCINA' } } } },
                    ],
                },
                select: { id: true },
            });
            if (!kitchenUser) throw new OperationalDeviceError('Usuario de cocina inválido', 400);
            kitchenUserId = kitchenUser.id;
        }

        const deviceToken = crypto.randomBytes(32).toString('base64url');
        const device = await prisma.operationalDevice.create({
            data: {
                companyId: actor.companyId,
                branchId: branch.id,
                type: input.type,
                name,
                tokenHash: hashDeviceToken(deviceToken),
                kitchenUserId,
                createdById: actor.userId,
            },
        });

        await AuditLogService.log({
            companyId: actor.companyId,
            userId: actor.userId,
            entityType: 'OperationalDevice',
            entityId: device.id,
            action: 'OPERATIONAL_DEVICE_REGISTERED',
            details: { branchId: branch.id, type: input.type, name, kitchenUserId },
        });

        return { device, deviceToken };
    }

    /** Returns the ACTIVE device owning this token (touching lastSeenAt), else null. */
    static async resolveActive(deviceToken: string): Promise<OperationalDevice | null> {
        if (typeof deviceToken !== 'string' || deviceToken.length === 0 || deviceToken.length > 512) {
            return null;
        }
        const device = await prisma.operationalDevice.findUnique({
            where: { tokenHash: hashDeviceToken(deviceToken) },
        });
        if (!device || device.status !== 'ACTIVE') return null;
        return prisma.operationalDevice.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date() },
        });
    }

    static async list(actor: DeviceActor, branchId?: number): Promise<OperationalDevice[]> {
        return prisma.operationalDevice.findMany({
            where: { companyId: actor.companyId, ...(branchId ? { branchId } : {}) },
            orderBy: { createdAt: 'desc' },
        });
    }

    static async revoke(
        actor: DeviceActor,
        deviceId: number,
        opts: { branchScope?: number } = {},
    ): Promise<void> {
        const device = await prisma.operationalDevice.findFirst({
            where: { id: deviceId, companyId: actor.companyId },
        });
        // A branch-pinned actor cannot see (or revoke) devices of other branches.
        if (!device || (opts.branchScope !== undefined && device.branchId !== opts.branchScope)) {
            throw new OperationalDeviceError('Dispositivo no encontrado', 404);
        }

        const now = new Date();
        await prisma.operationalDevice.updateMany({
            where: { id: device.id, companyId: actor.companyId, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedById: actor.userId, revokedAt: now },
        });
        // Always sweep sessions, even if the device was already revoked: it is idempotent.
        const revokedSessions = await SessionService.revokeByDevice(deviceSessionTag(device.id));

        await AuditLogService.log({
            companyId: actor.companyId,
            userId: actor.userId,
            entityType: 'OperationalDevice',
            entityId: device.id,
            action: 'OPERATIONAL_DEVICE_REVOKED',
            details: { revokedSessions },
        });
    }
}
