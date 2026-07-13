import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { SessionService } from '../services/session.service';
import { DEFAULT_COMPANY_SETTINGS } from '../services/setting.service';
import { isValidTimeZone } from '../utils/timezone';

declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: number;
                role: string;
                roles: string[];
                roleObj?: { name: string };
                branchId?: number;
                companyId: number;
                timezone: string;
            };
        }
    }
}

export const auth = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const token = extractAuthToken(req);

        if (!token) {
            return res.status(401).json({ success: false, message: 'Token no proporcionado' });
        }

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            return res.status(500).json({ success: false, message: 'Error de configuración del servidor' });
        }
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: number; role: string; branchId?: number; companyId?: number };

        const sessionIsValid = await SessionService.isValid(token);
        if (!sessionIsValid) {
            return res.status(401).json({ success: false, message: 'Sesión revocada o expirada' });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                branchId: true,
                companyId: true,
                role: { select: { name: true } },
                userRoles: { select: { role: { select: { name: true } } } },
                status: true,
                mustChangePassword: true,
                passwordChangedAt: true,
                company: {
                    select: {
                        active: true,
                        settings: {
                            where: { name: { endsWith: '_timezone' } },
                            select: { value: true },
                            take: 1
                        }
                    }
                },
                branch: { select: { status: true } },
                allowedBranches: { select: { branchId: true } }
            }
        });

        if (!user || user.status !== 'ACTIVE') {
            return res.status(401).json({ success: false, message: 'Usuario no encontrado o inactivo' });
        }

        if (!user.companyId) {
            console.error('[AUTH] User has no companyId:', user.id);
            return res.status(403).json({
                success: false,
                message: 'El usuario no está asociado a una empresa. Contacte al administrador.'
            });
        }

        const allRoles: string[] = Array.from(new Set([
            user.role.name,
            ...user.userRoles.map((ur) => ur.role.name)
        ])).filter((name) => name !== 'SUPERADMIN' || user.role.name === 'SUPERADMIN');

        const isSuperAdmin = allRoles.includes('SUPERADMIN');
        if ((user.company?.active !== true || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) {
            return res.status(403).json({ success: false, message: 'Empresa o sucursal inactiva' });
        }
        if (
            !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
            !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
        ) {
            return res.status(403).json({ success: false, message: 'La sucursal activa no estÃ¡ permitida para este usuario' });
        }

        const configuredTimezone = user.company?.settings?.[0]?.value?.trim();
        const timezone = configuredTimezone && isValidTimeZone(configuredTimezone)
            ? configuredTimezone
            : DEFAULT_COMPANY_SETTINGS.timezone;

        req.user = {
            userId: user.id,
            role: user.role.name,
            roles: allRoles,
            roleObj: user.role,
            branchId: user.branchId || undefined,
            companyId: user.companyId,
            timezone
        };

        // Password-policy flags are security controls, not UI hints. Keep only
        // the minimum endpoints needed to inspect/logout/change the password
        // reachable until the credential is compliant again.
        const passwordChangeAllowedPaths = new Set([
            '/api/auth/me',
            '/api/auth/logout',
            '/api/auth/change-password'
        ]);
        let passwordChangeRequired = user.mustChangePassword;
        if (!passwordChangeRequired && user.passwordChangedAt) {
            const expirySetting = await prisma.setting.findFirst({
                where: {
                    companyId: user.companyId,
                    name: `${user.companyId}_password_expiry_days`
                },
                select: { value: true }
            });
            const expiryDays = expirySetting ? Number.parseInt(expirySetting.value, 10) : 90;
            if (Number.isInteger(expiryDays) && expiryDays > 0) {
                passwordChangeRequired = Date.now() - new Date(user.passwordChangedAt).getTime()
                    >= expiryDays * 24 * 60 * 60 * 1000;
            }
        }
        if (passwordChangeRequired && !passwordChangeAllowedPaths.has(req.originalUrl.split('?')[0])) {
            return res.status(403).json({
                success: false,
                code: 'PASSWORD_CHANGE_REQUIRED',
                message: 'Debe cambiar su contraseÃ±a antes de continuar'
            });
        }

        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
    }
};

function extractAuthToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';');
    for (const rawCookie of cookies) {
        const [key, ...valueParts] = rawCookie.trim().split('=');
        if (key === 'auth_token') {
            const value = valueParts.join('=');
            if (value) return decodeURIComponent(value);
        }
    }

    return null;
}

export const authenticate = auth;
export const authMiddleware = auth;

export const requireRole = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'No autenticado' });
        }
        const userRoles = req.user.roles || [req.user.role];
        const hasRole = userRoles.some(r => roles.includes(r));
        if (!hasRole) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions'
            });
        }
        next();
    };
};

// Small in-memory TTL cache of the permission names granted to a user (via their roles).
const PERMISSION_CACHE_TTL_MS = 60_000;
const permissionCache = new Map<number, { permissions: Set<string>; expiresAt: number }>();

async function getUserPermissions(userId: number): Promise<Set<string>> {
    const cached = permissionCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.permissions;
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            role: { select: { permissions: { select: { name: true } } } },
            userRoles: { select: { role: { select: { permissions: { select: { name: true } } } } } }
        }
    });

    const permissions = new Set<string>();
    user?.role?.permissions?.forEach((p) => permissions.add(p.name));
    user?.userRoles?.forEach((ur) => ur.role?.permissions?.forEach((p) => permissions.add(p.name)));

    permissionCache.set(userId, { permissions, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
    return permissions;
}

/** Clears the cached permissions for a user (call after role/permission changes). */
export const invalidatePermissionCache = (userId?: number) => {
    if (typeof userId === 'number') {
        permissionCache.delete(userId);
    } else {
        permissionCache.clear();
    }
};

/**
 * Permission-based guard with role fallback.
 *
 * Grants access when the user holds the named permission OR has one of the
 * provided fallback roles. The role fallback keeps existing deployments working
 * even when role↔permission links have not been seeded yet, while allowing the
 * permission model to grant access additively once configured.
 */
export const requirePermission = (permission: string, ...fallbackRoles: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'No autenticado' });
        }

        const userRoles = req.user.roles || [req.user.role];
        if (fallbackRoles.length > 0 && userRoles.some((r) => fallbackRoles.includes(r))) {
            return next();
        }

        try {
            const permissions = await getUserPermissions(req.user.userId);
            if (permissions.has(permission)) {
                return next();
            }
        } catch {
            // On lookup failure, deny by permission but rely on fallback roles already checked above.
        }

        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    };
};
