import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { SessionService } from './session.service';
import { TwoFactorService } from './twoFactor.service';
import { ROLES } from '../constants/roles';
import {
    assertStrongPassword,
    BCRYPT_ROUNDS
} from '../utils/password-policy';
import { collectPermissionNames } from '../utils/permission-names';
import { AuditLogService } from './audit-log.service';
import { loginAttemptService } from './login-attempt.service';

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
            include: {
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
                employee: { select: { id: true } }
            }
        });

        if (!user) {
            // Unknown usernames are intentionally not materialized in the DB:
            // the bounded HTTP limiter protects this path from row-exhaustion.
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            throw new Error('Credenciales inválidas');
        }
        await loginAttemptService.assertAllowed(user.id);
        if (user.status !== 'ACTIVE') {
            await loginAttemptService.recordFailure(user.id);
            throw new Error('Credenciales inválidas'); // Don't reveal account status
        }

        const authoritativeRoleNames = Array.from(new Set([
            user.role.name,
            ...user.userRoles.map((entry) => entry.role.name)
        ])).filter((name) => name !== ROLES.SUPERADMIN || user.role.name === ROLES.SUPERADMIN);
        const isSuperAdmin = authoritativeRoleNames.includes(ROLES.SUPERADMIN);
        if ((!user.company?.active || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) {
            await loginAttemptService.recordFailure(user.id);
            throw new Error('Credenciales inválidas');
        }
        if (
            !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
            !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
        ) {
            await loginAttemptService.recordFailure(user.id);
            throw new Error('Credenciales inválidas');
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            await loginAttemptService.recordFailure(user.id);
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
                await loginAttemptService.recordFailure(user.id);
                throw new Error('Código 2FA inválido');
            }
        }

        await loginAttemptService.recordSuccess(user.id);

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
            throw new Error('Credenciales inválidas');
        }
        await prisma.$transaction(async (tx) => {
            const session = await SessionService.create(
                user.id,
                token,
                ip,
                userAgent,
                sessionTimeoutMinutes,
                tx,
            );
            await AuditLogService.log({
                companyId: user.companyId!,
                userId: user.id,
                entityType: 'UserSession',
                entityId: user.id,
                action: 'LOGIN',
                details: {
                    sessionId: session.id,
                    ipAddress: ip || null,
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
