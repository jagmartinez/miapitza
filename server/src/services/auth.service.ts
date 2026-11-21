import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { SessionService } from './session.service';
import { TwoFactorService } from './twoFactor.service';
import { ROLES, PIN_ROLES } from '../constants/roles';
import {
    assertStrongPassword,
    BCRYPT_ROUNDS
} from '../utils/password-policy';
import { collectPermissionNames } from '../utils/permission-names';
import { AuditLogService } from './audit-log.service';
import { loginAttemptService } from './login-attempt.service';
import { OperationalDeviceService, deviceSessionTag, isKitchenDeviceUser } from './operational-device.service';
import { PinService } from './pin.service';
import type { AuditAction } from './audit-log.service';

export { BCRYPT_ROUNDS, PASSWORD_REGEX } from '../utils/password-policy';

// Cost 12, aligned with BCRYPT_ROUNDS. Comparing against this immutable hash
// keeps the unknown-user path from returning before the expensive verifier.
const DUMMY_PASSWORD_HASH = '$2a$12$m7N0cnrKHlL.SDwMiWxrC.RygLI/H8rmiroe/0eEp15SO752w7zl6';

/**
 * Periodic cleanup of expired shared lockout rows.
 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function cleanupExpiredEntries(): void {
    loginAttemptService.purgeStale().catch((error) => {
        console.error('[AUTH] Failed to purge stale login attempts', {
            errorType: error instanceof Error ? error.name : typeof error,
        });
    });
}

const cleanupTimer = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);
// Allow the process to exit without waiting for this timer
if (cleanupTimer.unref) cleanupTimer.unref();

/** Expose for graceful shutdown */
export function stopAuthCleanup(): void {
    clearInterval(cleanupTimer);
}

const LOGIN_USER_INCLUDE = {
    role: {
        select: {
            id: true,
            name: true,
            permissions: { select: { name: true } },
        },
    },
    userRoles: {
        select: {
            role: {
                select: {
                    id: true,
                    name: true,
                    permissions: { select: { name: true } },
                },
            },
        },
    },
    company: { select: { id: true, name: true, ruc: true, active: true } },
    branch: { select: { status: true } },
    allowedBranches: { select: { branchId: true } },
    employee: { select: { id: true } },
} satisfies Prisma.UserInclude;

export type LoginUserRecord = Prisma.UserGetPayload<{ include: typeof LOGIN_USER_INCLUDE }>;

export interface IssueSessionOptions {
    ip?: string;
    userAgent?: string;
    idleTimeoutMinutes: number;
    deviceTag?: string;
    auditAction: Extract<AuditAction, 'LOGIN' | 'PIN_LOGIN' | 'DEVICE_LOGIN'>;
    /** Runs first inside the session transaction; throw to abort issuing the session. */
    guard?: (tx: Prisma.TransactionClient) => Promise<void>;
    /** With a deviceTag: revoke that device's earlier live sessions in the issuing transaction. */
    revokePriorDeviceSessions?: boolean;
}

export type LoginResult = Awaited<ReturnType<typeof AuthService.issueSession>>;

const GENERIC_AUTH_ERROR = 'Credenciales inválidas';

const DEVICE_AUTH_ERRORS = {
    DEVICE_NOT_ACTIVE: { statusCode: 401, message: 'Dispositivo no autorizado' },
    KITCHEN_ACCOUNT_UNAVAILABLE: {
        statusCode: 403,
        message: 'La cuenta de cocina no está disponible. Avisa al administrador.',
    },
} as const;

/** Typed device-login failure so the kitchen app can tell "unpair" from "ask the admin". */
export class DeviceAuthError extends Error {
    readonly code: keyof typeof DEVICE_AUTH_ERRORS;
    readonly statusCode: 401 | 403;
    constructor(code: keyof typeof DEVICE_AUTH_ERRORS) {
        super(DEVICE_AUTH_ERRORS[code].message);
        this.name = 'DeviceAuthError';
        this.code = code;
        this.statusCode = DEVICE_AUTH_ERRORS[code].statusCode;
    }
}

const PIN_USER_LOCK_ERROR = /temporarily locked/i;
const DEVICE_PIN_MAX_FAILURES = 20;
const DEVICE_PIN_WINDOW_MS = 15 * 60 * 1000;
// A per-user row resets to 0 when it locks (after this many failures), so a
// row that is locked inside the window still stands for this many guesses.
const USER_LOCK_THRESHOLD = 5;
const PIN_SESSION_IDLE_MINUTES = 15;
const KITCHEN_SESSION_IDLE_MINUTES = 24 * 60;
const PIN_ROLES_LIST: string[] = [...PIN_ROLES];

const deviceLockKey = (deviceId: number) => `device:${deviceId}`;

async function deviceIsPinLocked(deviceId: number): Promise<boolean> {
    const since = new Date(Date.now() - DEVICE_PIN_WINDOW_MS);
    const rows = await prisma.loginAttempt.findMany({
        where: { ipKey: deviceLockKey(deviceId), lastAttemptAt: { gte: since } },
        select: { failedCount: true, lockedUntil: true },
    });
    const failures = rows.reduce(
        (sum, row) => sum + row.failedCount + (row.lockedUntil ? USER_LOCK_THRESHOLD : 0),
        0,
    );
    return failures >= DEVICE_PIN_MAX_FAILURES;
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
    return letters.map((part) => part[0]!.toUpperCase()).join('').slice(0, 2);
}

async function assertDeviceStillActive(tx: Prisma.TransactionClient, deviceId: number): Promise<void> {
    if (!(await OperationalDeviceService.isActiveForUpdate(tx, deviceId))) {
        throw new Error(GENERIC_AUTH_ERROR);
    }
}

function isUserEligibleContext(user: LoginUserRecord, device: { companyId: number }): boolean {
    if (user.status !== 'ACTIVE' || !user.companyId || user.companyId !== device.companyId) return false;
    if (!user.company?.active) return false;
    if (user.branchId && user.branch?.status !== 'ACTIVE') return false;
    return true;
}

function roleNamesOf(user: LoginUserRecord): string[] {
    return Array.from(new Set([user.role.name, ...user.userRoles.map((entry) => entry.role.name)]));
}

/** Pinned users must be in the device branch; tenant-wide users need an explicit grant. */
function hasBranchAccess(user: LoginUserRecord, branchId: number): boolean {
    if (user.branchId) return user.branchId === branchId;
    return user.allowedBranches.some((entry) => entry.branchId === branchId);
}

export class AuthService {
    static async register(data: {
        name: string;
        email: string;
        username: string;
        password: string;
        roleId: number;
        branchId?: number;
        companyId?: number;
    }, canAssignGlobalRoles = false) {
        // Validate password strength on registration
        assertStrongPassword(data.password);

        const role = await prisma.role.findUnique({
            where: { id: data.roleId },
            select: { id: true, companyId: true, name: true }
        });
        if (!role) {
            throw new Error('Role not found');
        }

        // Privilege guard: only the explicitly pinned platform operator may
        // assign global roles, and their holder remains in the platform company.
        if (role.companyId === null) {
            if (!canAssignGlobalRoles) {
                throw new Error('No autorizado para asignar un rol global');
            }
            const platformCompanyId = Number.parseInt(
                process.env.PLATFORM_ADMIN_COMPANY_ID?.trim() || '',
                10,
            );
            if (!Number.isInteger(platformCompanyId) || data.companyId !== platformCompanyId) {
                throw new Error('Los roles globales solo pueden pertenecer a la empresa operadora');
            }
        } else if (role.companyId !== data.companyId) {
            throw new Error('Role does not belong to the target company');
        }
        if (role.name === ROLES.SUPERADMIN && !canAssignGlobalRoles) {
            throw new Error('No autorizado para asignar el rol SUPERADMIN');
        }

        if (data.branchId) {
            const branch = await prisma.branch.findFirst({
                where: { id: data.branchId, companyId: data.companyId }
            });
            if (!branch) {
                throw new Error('Branch not found or does not belong to the target company');
            }
        }

        const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

        const user = await prisma.user.create({
            data: {
                ...data,
                password: hashedPassword,
                mustChangePassword: true,
                passwordChangedAt: null,
            },
            select: {
                id: true, name: true, email: true, username: true,
                roleId: true, branchId: true, companyId: true, status: true,
                accountType: true,
                role: { select: { id: true, name: true } }
            }
        });

        return user;
    }

    static async login(username: string, password: string, twoFactorCode?: string, ip?: string, userAgent?: string) {
        const user = await prisma.user.findUnique({
            where: { username },
            include: LOGIN_USER_INCLUDE,
        });

        if (!user) {
            // Unknown usernames are intentionally not materialized in the DB:
            // the bounded HTTP limiter protects this path from row-exhaustion.
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            throw new Error('Credenciales inválidas');
        }
        try {
            await loginAttemptService.assertAllowed(user.id, ip);
        } catch (lockError) {
            // Keep the lock server-side only: a distinct client message would
            // reveal which usernames exist. Equalize timing with the bcrypt path.
            console.warn('[AUTH] Login blocked by active lockout', { userId: user.id });
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            if (lockError instanceof Error && /temporarily locked/i.test(lockError.message)) {
                throw new Error('Credenciales inválidas');
            }
            throw lockError;
        }
        if (user.status !== 'ACTIVE') {
            await loginAttemptService.recordFailure(user.id, ip);
            throw new Error('Credenciales inválidas'); // Don't reveal account status
        }

        const authoritativeRoleNames = Array.from(new Set([
            user.role.name,
            ...user.userRoles.map((entry) => entry.role.name)
        ])).filter((name) => name !== ROLES.SUPERADMIN || user.role.name === ROLES.SUPERADMIN);
        const isSuperAdmin = authoritativeRoleNames.includes(ROLES.SUPERADMIN);
        if ((!user.company?.active || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) {
            await loginAttemptService.recordFailure(user.id, ip);
            throw new Error('Credenciales inválidas');
        }
        if (
            !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
            !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
        ) {
            await loginAttemptService.recordFailure(user.id, ip);
            throw new Error('Credenciales inválidas');
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            await loginAttemptService.recordFailure(user.id, ip);
            throw new Error('Credenciales inválidas');
        }

        // 2FA check: if enabled, require code
        if (user.twoFactorEnabled) {
            if (!twoFactorCode) {
                // Return a temporary opaque token instead of userId
                // Store temp token → userId mapping (expires in 5 min)
                return { requires2FA: true };
            }
            let valid2FA = await TwoFactorService.validateCode(user.id, twoFactorCode);
            if (!valid2FA) {
                valid2FA = await TwoFactorService.validateRecoveryCode(user.id, twoFactorCode);
            }
            if (!valid2FA) {
                await loginAttemptService.recordFailure(user.id, ip);
                throw new Error('Código 2FA inválido');
            }
        }

        try {
            await loginAttemptService.recordSuccess(user.id, ip);
        } catch (lockError) {
            // A lock established concurrently by another replica: same generic message.
            if (lockError instanceof Error && /temporarily locked/i.test(lockError.message)) {
                throw new Error('Credenciales inválidas');
            }
            throw lockError;
        }

        // Read session timeout
        let sessionTimeoutMinutes = 30;
        if (user.companyId) {
            const timeoutSetting = await prisma.setting.findFirst({
                where: { companyId: user.companyId, name: `${user.companyId}_session_timeout_minutes` }
            });
            if (timeoutSetting) {
                const parsedTimeout = Number.parseInt(timeoutSetting.value, 10);
                if (Number.isInteger(parsedTimeout) && parsedTimeout > 0) {
                    sessionTimeoutMinutes = Math.min(parsedTimeout, 24 * 60);
                }
            }
        }

        return AuthService.issueSession(user, {
            ip,
            userAgent,
            idleTimeoutMinutes: sessionTimeoutMinutes,
            auditAction: 'LOGIN',
        });
    }

    /**
     * Signs the JWT, tracks the session and audits it. Shared by password,
     * PIN and device logins; the caller has already authenticated the user.
     */
    static async issueSession(user: LoginUserRecord, opts: IssueSessionOptions) {
        // Check password expiry
        let passwordExpired = false;
        if (user.passwordChangedAt && user.companyId) {
            const expirySetting = await prisma.setting.findFirst({
                where: { companyId: user.companyId, name: `${user.companyId}_password_expiry_days` }
            });
            const expiryDays = expirySetting ? parseInt(expirySetting.value) : 90;
            if (expiryDays > 0) {
                const daysSinceChange = (Date.now() - new Date(user.passwordChangedAt).getTime()) / (1000 * 60 * 60 * 24);
                passwordExpired = daysSinceChange >= expiryDays;
            }
        }
        const sessionTimeoutMinutes = opts.idleTimeoutMinutes;

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not configured');

        const allRoleRecords = [user.role, ...user.userRoles.map((ur) => ur.role)]
            .filter((role, index, roles) => roles.findIndex((candidate) => candidate.id === role.id) === index)
            .filter((role) => role.name !== ROLES.SUPERADMIN || user.role.name === ROLES.SUPERADMIN);
        const allRoles = allRoleRecords.map(({ id, name }) => ({ id, name }));
        const roleNames = allRoles.map((r: { id: number; name: string }) => r.name);
        const permissions = collectPermissionNames(allRoleRecords);

        const token = jwt.sign(
            { userId: user.id, role: user.role.name, roles: roleNames, branchId: user.branchId, companyId: user.companyId },
            JWT_SECRET,
            { expiresIn: '8h', algorithm: 'HS256' }
        );

        // Track session — failure means token cannot be validated later
        if (!user.companyId) {
            throw new Error(GENERIC_AUTH_ERROR);
        }
        await prisma.$transaction(async (tx) => {
            if (opts.guard) await opts.guard(tx);
            if (opts.revokePriorDeviceSessions && opts.deviceTag) {
                await tx.userSession.updateMany({
                    where: { device: opts.deviceTag, revoked: false },
                    data: { revoked: true },
                });
            }
            const session = await SessionService.create(
                user.id,
                token,
                opts.ip,
                opts.userAgent,
                sessionTimeoutMinutes,
                tx,
                opts.deviceTag,
            );
            await AuditLogService.log({
                companyId: user.companyId!,
                userId: user.id,
                entityType: 'UserSession',
                entityId: user.id,
                action: opts.auditAction,
                details: {
                    sessionId: session.id,
                    ipAddress: opts.ip || null,
                    device: session.device,
                },
            }, tx);
        });

        return {
            token,
            user: {
                id: user.id, name: user.name, email: user.email, username: user.username,
                role: { id: user.role.id, name: user.role.name }, roles: allRoles, branchId: user.branchId,
                companyId: user.companyId, company: user.company, color: user.color,
                accountType: user.accountType,
                employeeId: user.employee?.id,
                permissions,
            },
            mustChangePassword: user.mustChangePassword,
            passwordExpired,
            sessionTimeoutMinutes,
        };
    }

    /**
     * Quick PIN sign-in on a shared service tablet. Every failure surfaces the
     * same generic error so nothing (device state, lockout, user existence,
     * eligibility) can be probed.
     */
    static async pinLogin(input: {
        deviceToken: string;
        userId: number;
        pin: string;
        ip?: string;
        userAgent?: string;
    }): Promise<LoginResult> {
        const device = await OperationalDeviceService.resolveActive(input.deviceToken);
        if (!device || device.type !== 'SERVICE_TABLET') throw new Error(GENERIC_AUTH_ERROR);

        if (await deviceIsPinLocked(device.id)) {
            console.warn('[AUTH] PIN login blocked by device lockout', { deviceId: device.id });
            await bcrypt.compare(String(input.pin), DUMMY_PASSWORD_HASH);
            throw new Error(GENERIC_AUTH_ERROR);
        }

        const user = Number.isInteger(input.userId)
            ? await prisma.user.findUnique({ where: { id: input.userId }, include: LOGIN_USER_INCLUDE })
            : null;
        if (!user) {
            await bcrypt.compare(String(input.pin), DUMMY_PASSWORD_HASH);
            throw new Error(GENERIC_AUTH_ERROR);
        }

        const lockKey = deviceLockKey(device.id);
        try {
            await loginAttemptService.assertAllowed(user.id, lockKey);
        } catch (lockError) {
            console.warn('[AUTH] PIN login blocked by active lockout', { userId: user.id, deviceId: device.id });
            await bcrypt.compare(String(input.pin), DUMMY_PASSWORD_HASH);
            if (lockError instanceof Error && PIN_USER_LOCK_ERROR.test(lockError.message)) {
                throw new Error(GENERIC_AUTH_ERROR);
            }
            throw lockError;
        }

        const eligible = isUserEligibleContext(user, device)
            && hasBranchAccess(user, device.branchId)
            && PinService.rolesAllowPin(roleNamesOf(user))
            && !!user.pinHash;
        // Always run one bcrypt comparison so timing does not reveal eligibility.
        const pinMatches = await bcrypt.compare(
            String(input.pin),
            eligible ? user.pinHash! : DUMMY_PASSWORD_HASH,
        );
        if (!eligible || !pinMatches) {
            await loginAttemptService.recordFailure(user.id, lockKey);
            throw new Error(GENERIC_AUTH_ERROR);
        }

        try {
            await loginAttemptService.recordSuccess(user.id, lockKey);
        } catch (lockError) {
            if (lockError instanceof Error && PIN_USER_LOCK_ERROR.test(lockError.message)) {
                throw new Error(GENERIC_AUTH_ERROR);
            }
            throw lockError;
        }

        return AuthService.issueSession(user, {
            ip: input.ip,
            userAgent: input.userAgent,
            idleTimeoutMinutes: PIN_SESSION_IDLE_MINUTES,
            deviceTag: deviceSessionTag(device.id),
            auditAction: 'PIN_LOGIN',
            // Closes the revoke-vs-login race: the device must still be ACTIVE
            // inside the transaction that creates the session.
            guard: (tx) => assertDeviceStillActive(tx, device.id),
        });
    }

    /** Fixed kitchen tablet: the device token alone opens the branch kitchen account. */
    static async deviceLogin(input: {
        deviceToken: string;
        ip?: string;
        userAgent?: string;
    }): Promise<LoginResult> {
        const device = await OperationalDeviceService.resolveActive(input.deviceToken);
        if (!device || device.type !== 'KITCHEN_TABLET' || !device.kitchenUserId) {
            throw new DeviceAuthError('DEVICE_NOT_ACTIVE');
        }

        const user = await prisma.user.findUnique({
            where: { id: device.kitchenUserId },
            include: LOGIN_USER_INCLUDE,
        });
        const roleNames = user ? roleNamesOf(user) : [];
        if (
            !user
            || !isUserEligibleContext(user, device)
            || user.branchId !== device.branchId
            || !isKitchenDeviceUser(roleNames)
        ) {
            throw new DeviceAuthError('KITCHEN_ACCOUNT_UNAVAILABLE');
        }

        return AuthService.issueSession(user, {
            ip: input.ip,
            userAgent: input.userAgent,
            idleTimeoutMinutes: KITCHEN_SESSION_IDLE_MINUTES,
            deviceTag: deviceSessionTag(device.id),
            auditAction: 'DEVICE_LOGIN',
            revokePriorDeviceSessions: true,
            // Only a genuine "not active" result unpairs; DB/infra errors propagate as 5xx.
            guard: async (tx) => {
                if (!(await OperationalDeviceService.isActiveForUpdate(tx, device.id))) {
                    throw new DeviceAuthError('DEVICE_NOT_ACTIVE');
                }
            },
        });
    }

    /**
     * Sign-in roster for a service tablet. Exposes only what the picker needs:
     * no PIN length or any PIN-derived data.
     */
    static async deviceRoster(deviceToken: string): Promise<Array<{
        id: number; name: string; initials: string; color: string | null;
    }>> {
        const device = await OperationalDeviceService.resolveActive(deviceToken);
        if (!device || device.type !== 'SERVICE_TABLET') throw new Error(GENERIC_AUTH_ERROR);

        const users = await prisma.user.findMany({
            where: {
                companyId: device.companyId,
                status: 'ACTIVE',
                pinHash: { not: null },
                role: { name: { in: PIN_ROLES_LIST } },
                userRoles: { none: { role: { name: { notIn: PIN_ROLES_LIST } } } },
                OR: [
                    { branchId: device.branchId },
                    { branchId: null, allowedBranches: { some: { branchId: device.branchId } } },
                ],
            },
            select: { id: true, name: true, color: true },
            orderBy: { name: 'asc' },
        });
        return users.map((user) => ({
            id: user.id,
            name: user.name,
            initials: initialsOf(user.name),
            color: user.color ?? null,
        }));
    }

    static async changePassword(userId: number, oldPassword: string, newPassword: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        const isValid = await bcrypt.compare(oldPassword, user.password);
        if (!isValid) throw new Error('Contraseña actual incorrecta');

        assertStrongPassword(newPassword);

        if (oldPassword === newPassword) {
            throw new Error('La nueva contraseña debe ser diferente a la actual');
        }

        const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        if (!user.companyId) throw new Error('El usuario no está asociado a una empresa');
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: { password: hashed, mustChangePassword: false, passwordChangedAt: new Date() }
            });

            await SessionService.revokeAll(userId, tx);
            await AuditLogService.log({
                companyId: user.companyId!,
                userId,
                entityType: 'User',
                entityId: userId,
                action: 'PASSWORD_CHANGE',
            }, tx);
        });

        return { success: true };
    }
}
