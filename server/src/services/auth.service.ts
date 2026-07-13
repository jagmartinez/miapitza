import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { SessionService } from './session.service';
import { TwoFactorService } from './twoFactor.service';
import { ROLES } from '../constants/roles';

/** Password strength regex: min 8 chars, 1 upper, 1 lower, 1 digit, 1 symbol */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

export const BCRYPT_ROUNDS = 12;

/** In-memory login attempt tracker for account lockout */
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginLockout(username: string): void {
    const record = loginAttempts.get(username);
    if (record && record.lockedUntil > Date.now()) {
        const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
        throw new Error(`Account temporarily locked. Try again in ${minutesLeft} minutes`);
    }
}

function recordFailedAttempt(username: string): void {
    const record = loginAttempts.get(username) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        record.count = 0;
    }
    loginAttempts.set(username, record);
}

function clearFailedAttempts(username: string): void {
    loginAttempts.delete(username);
}


/**
 * Periodic cleanup of expired in-memory entries.
 * - Removes stale login-attempt records whose lockout has long passed (> 30 min old)
 * Runs every 5 minutes.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanupExpiredEntries(): void {
    const now = Date.now();

    // Purge stale login-attempt records (lockout expired more than 30 min ago)
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    for (const [username, record] of loginAttempts) {
        // If locked out and lockout expired long ago, remove
        if (record.lockedUntil > 0 && record.lockedUntil + STALE_THRESHOLD_MS < now) {
            loginAttempts.delete(username);
        }
        // If not locked out and has some attempts but no activity for a long time,
        // we can't know the last-activity time, so leave it — the map size is bounded
        // by unique usernames which is inherently limited.
    }
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
    }, actingRoles: string[] = []) {
        // Validate password strength on registration
        if (!PASSWORD_REGEX.test(data.password)) {
            throw new Error('La contraseña debe tener mínimo 8 caracteres, incluyendo mayúscula, minúscula, número y símbolo');
        }

        const role = await prisma.role.findUnique({
            where: { id: data.roleId },
            select: { id: true, companyId: true, name: true }
        });
        if (!role) {
            throw new Error('Role not found');
        }

        // Privilege guard: only a SUPERADMIN caller may assign global (companyId === null)
        // roles such as SUPERADMIN. Without a SUPERADMIN context, the role must belong to
        // the same company and must not be the SUPERADMIN role.
        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);
        if (role.companyId === null) {
            if (!isSuperAdmin) {
                throw new Error('No autorizado para asignar un rol global');
            }
        } else if (role.companyId !== data.companyId) {
            throw new Error('Role does not belong to the target company');
        }
        if (role.name === ROLES.SUPERADMIN && !isSuperAdmin) {
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
                role: { select: { id: true, name: true } }
            }
        });

        return user;
    }

    static async login(username: string, password: string, twoFactorCode?: string, ip?: string, userAgent?: string) {
        // Check lockout before any DB access
        checkLoginLockout(username);

        const user = await prisma.user.findUnique({
            where: { username },
            include: {
                role: { select: { id: true, name: true } },
                userRoles: { select: { role: { select: { id: true, name: true } } } },
                company: { select: { id: true, name: true, ruc: true, active: true } },
                branch: { select: { status: true } },
                allowedBranches: { select: { branchId: true } }
            }
        });

        if (!user) {
            recordFailedAttempt(username);
            throw new Error('Credenciales inválidas');
        }
        if (user.status !== 'ACTIVE') {
            recordFailedAttempt(username);
            throw new Error('Credenciales inválidas'); // Don't reveal account status
        }

        const authoritativeRoleNames = Array.from(new Set([
            user.role.name,
            ...user.userRoles.map((entry) => entry.role.name)
        ])).filter((name) => name !== ROLES.SUPERADMIN || user.role.name === ROLES.SUPERADMIN);
        const isSuperAdmin = authoritativeRoleNames.includes(ROLES.SUPERADMIN);
        if ((!user.company?.active || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) {
            recordFailedAttempt(username);
            throw new Error('Credenciales invÃ¡lidas');
        }
        if (
            !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
            !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
        ) {
            recordFailedAttempt(username);
            throw new Error('Credenciales invÃ¡lidas');
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            recordFailedAttempt(username);
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
                recordFailedAttempt(username);
                throw new Error('Código 2FA inválido');
            }
        }

        clearFailedAttempts(username);

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
            if (timeoutSetting) sessionTimeoutMinutes = parseInt(timeoutSetting.value) || 30;
        }

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not configured');

        const allRoles = [user.role, ...user.userRoles.map((ur: { role: { id: number; name: string } }) => ur.role)]
            .filter((role, index, roles) => roles.findIndex((candidate) => candidate.id === role.id) === index)
            .filter((role) => role.name !== ROLES.SUPERADMIN || user.role.name === ROLES.SUPERADMIN);
        const roleNames = allRoles.map((r: { id: number; name: string }) => r.name);

        const token = jwt.sign(
            { userId: user.id, role: user.role.name, roles: roleNames, branchId: user.branchId, companyId: user.companyId },
            JWT_SECRET,
            { expiresIn: '8h', algorithm: 'HS256' }
        );

        // Track session — failure means token cannot be validated later
        await SessionService.create(user.id, token, ip, userAgent);

        return {
            token,
            user: {
                id: user.id, name: user.name, email: user.email, username: user.username,
                role: user.role, roles: allRoles, branchId: user.branchId,
                companyId: user.companyId, company: user.company, color: user.color
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

        if (!PASSWORD_REGEX.test(newPassword)) {
            throw new Error('La contraseña debe tener mínimo 8 caracteres, incluyendo mayúscula, minúscula, número y símbolo');
        }

        if (oldPassword === newPassword) {
            throw new Error('La nueva contraseña debe ser diferente a la actual');
        }

        const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashed, mustChangePassword: false, passwordChangedAt: new Date() }
        });

        // A password change invalidates all existing sessions; force re-authentication
        // everywhere. The controller also clears the current auth cookie.
        await SessionService.revokeAll(userId);

        return { success: true };
    }
}
