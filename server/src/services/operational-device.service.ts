import crypto from 'crypto';
import type { OperationalDevice, OperationalDeviceType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';
import { SessionService } from './session.service';
import { WebSocketService } from './websocket.service';
import { ROLES, KITCHEN_DEVICE_ROLES } from '../constants/roles';

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

/**
 * Single source of truth for who may be the account of a kitchen tablet:
 * holds COCINA and no role outside KITCHEN_DEVICE_ROLES (a token-only kiosk
 * must not carry elevated permissions). Used by register and device-login.
 */
export function isKitchenDeviceUser(roleNames: string[]): boolean {
    return roleNames.includes(ROLES.COCINA)
        && roleNames.every((name) => (KITCHEN_DEVICE_ROLES as string[]).includes(name));
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
            where: { id: input.branchId, companyId: actor.companyId, status: 'ACTIVE' },
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
                },
                select: {
                    id: true,
                    role: { select: { name: true } },
                    userRoles: { select: { role: { select: { name: true } } } },
                },
            });
            const roleNames = kitchenUser
                ? [kitchenUser.role.name, ...kitchenUser.userRoles.map((entry) => entry.role.name)]
                : [];
            if (!kitchenUser || !isKitchenDeviceUser(roleNames)) {
                throw new OperationalDeviceError('Usuario de cocina inválido', 400);
            }
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

    /**
     * Locks the device row (SELECT ... FOR UPDATE) inside the caller's
     * transaction and reports whether it is still ACTIVE. `revoke` updates the
     * same row before sweeping sessions, so a login that holds this lock either
     * commits its session before the sweep or sees REVOKED and aborts.
     */
    static async isActiveForUpdate(tx: Prisma.TransactionClient, deviceId: number): Promise<boolean> {
        const rows = await tx.$queryRaw<Array<{ status: string }>>`
            SELECT status FROM \`OperationalDevice\` WHERE id = ${deviceId} FOR UPDATE
        `;
        return rows.length === 1 && rows[0].status === 'ACTIVE';
    }

    /**
     * Choices for registering a tablet: active branches the caller may act on,
     * each with the users `register` would accept as KITCHEN_TABLET account.
     */
    static async setupOptions(actor: DeviceActor, branchScope?: number): Promise<{
        branches: Array<{
            id: number;
            name: string;
            kitchenUsers: Array<{ id: number; name: string; username: string }>;
        }>;
    }> {
        const branches = await prisma.branch.findMany({
            where: {
                companyId: actor.companyId,
                status: 'ACTIVE',
                ...(branchScope !== undefined ? { id: branchScope } : {}),
            },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        if (branches.length === 0) return { branches: [] };

        const users = await prisma.user.findMany({
            where: {
                companyId: actor.companyId,
                status: 'ACTIVE',
                branchId: { in: branches.map((branch) => branch.id) },
            },
            select: {
                id: true,
                name: true,
                username: true,
                branchId: true,
                role: { select: { name: true } },
                userRoles: { select: { role: { select: { name: true } } } },
            },
            orderBy: { name: 'asc' },
        });

        return {
            branches: branches.map((branch) => ({
                id: branch.id,
                name: branch.name,
                kitchenUsers: users
                    .filter((user) => user.branchId === branch.id
                        && isKitchenDeviceUser([user.role.name, ...user.userRoles.map((entry) => entry.role.name)]))
                    .map((user) => ({ id: user.id, name: user.name, username: user.username })),
            })),
        };
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
        const tag = deviceSessionTag(device.id);
        const sessionHashes = await SessionService.activeHashesByDevice(tag);
        const revokedSessions = await SessionService.revokeByDevice(tag);
        // Do not wait for the next heartbeat: drop the device's sockets now.
        WebSocketService.closeBySessionHashes(sessionHashes, 'Device revoked');

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
