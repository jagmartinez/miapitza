import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { SessionService } from '../services/session.service';

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
                status: true
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

        const allRoles: string[] = user.userRoles.length > 0
            ? user.userRoles.map((ur) => ur.role.name)
            : [user.role.name];

        req.user = {
            userId: user.id,
            role: user.role.name,
            roles: allRoles,
            roleObj: user.role,
            branchId: user.branchId || undefined,
            companyId: user.companyId
        };

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
