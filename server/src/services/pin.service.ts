import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { PIN_ROLES } from '../constants/roles';
import { BCRYPT_ROUNDS } from '../utils/password-policy';
import { AuditLogService } from './audit-log.service';
import { loginAttemptService } from './login-attempt.service';
import { collectPermissionNames } from '../utils/permission-names';
import { DISCOUNT_AUTHORIZE_PERMISSION } from './discount-authorization.service';

export class PinError extends Error {
    constructor(message: string, public statusCode = 400) {
        super(message);
        this.name = 'PinError';
    }
}

const PIN_AUTH_ERROR = 'Credenciales inválidas';
const PIN_PATTERN = /^\d{4,6}$/;

function isRun(digits: number[], step: 1 | -1): boolean {
    return digits.every((digit, index) => index === 0 || digit - digits[index - 1] === step);
}

export class PinService {
    /** 4-6 digits, not a repeated digit, not an ascending/descending run. */
    static validateFormat(pin: string): void {
        if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
            throw new PinError('El PIN debe tener entre 4 y 6 dígitos');
        }
        const digits = pin.split('').map(Number);
        if (digits.every((digit) => digit === digits[0])) {
            throw new PinError('El PIN es demasiado fácil de adivinar');
        }
        if (isRun(digits, 1) || isRun(digits, -1)) {
            throw new PinError('El PIN es demasiado fácil de adivinar');
        }
    }

    /** True when every role the user holds may use a PIN (no elevated role mixed in). */
    static rolesAllowPin(roleNames: string[]): boolean {
        return roleNames.length > 0 && roleNames.every((name) => (PIN_ROLES as string[]).includes(name));
    }

    /** Same rule setPin enforces: PIN roles, or a discount supervisor (PIN never opens a session for them). */
    static canUsePin(roleNames: string[], permissionNames: string[]): boolean {
        return PinService.rolesAllowPin(roleNames) || permissionNames.includes(DISCOUNT_AUTHORIZE_PERMISSION);
    }

    static async hasPin(userId: number): Promise<boolean> {
        const row = await prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } });
        return Boolean(row?.pinHash);
    }

    /**
     * Sets the caller's own PIN. A PIN is a standing credential, so the account
     * password must be re-entered; every failure is the same generic 401 and
     * counts toward the user's login lockout. Neither value is ever logged.
     */
    static async setPin(userId: number, pin: string, currentPassword: unknown, ip?: string): Promise<void> {
        if (typeof currentPassword !== 'string' || currentPassword.length === 0 || currentPassword.length > 128) {
            throw new PinError(PIN_AUTH_ERROR, 401);
        }
        try {
            await loginAttemptService.assertAllowed(userId, ip);
        } catch {
            throw new PinError(PIN_AUTH_ERROR, 401);
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                password: true,
                companyId: true,
                status: true,
                role: { select: { name: true, permissions: { select: { name: true } } } },
                userRoles: { select: { role: { select: { name: true, permissions: { select: { name: true } } } } } },
            },
        });
        if (!user || user.status !== 'ACTIVE' || !user.companyId) {
            throw new PinError('Usuario no encontrado', 404);
        }
        if (!(await bcrypt.compare(currentPassword, user.password))) {
            await loginAttemptService.recordFailure(user.id, ip);
            throw new PinError(PIN_AUTH_ERROR, 401);
        }
        await loginAttemptService.recordSuccess(user.id, ip);
        PinService.validateFormat(pin);
        const roleNames = [user.role.name, ...user.userRoles.map((entry) => entry.role.name)];
        // A discount supervisor may hold a PIN to authorize discounts on a tablet.
        // That PIN never opens a session: pin-login still requires roles within PIN_ROLES.
        const permissionNames = collectPermissionNames([
            user.role,
            ...user.userRoles.map((entry) => entry.role),
        ]);
        if (!PinService.canUsePin(roleNames, permissionNames)) {
            throw new PinError('Tu rol no puede usar PIN de acceso rápido', 403);
        }

        const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: user.id },
                data: { pinHash, pinUpdatedAt: new Date() },
            });
            await AuditLogService.log({
                companyId: user.companyId!,
                userId: user.id,
                entityType: 'User',
                entityId: user.id,
                action: 'PIN_CHANGE',
            }, tx);
        });
    }
}
