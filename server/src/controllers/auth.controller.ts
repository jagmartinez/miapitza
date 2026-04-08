import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { TwoFactorService } from '../services/twoFactor.service';

export class AuthController {
    private static extractToken(req: Request): string {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.slice(7);
        }

        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) return '';

        const cookies = cookieHeader.split(';');
        for (const rawCookie of cookies) {
            const [key, ...valueParts] = rawCookie.trim().split('=');
            if (key === 'auth_token') {
                return decodeURIComponent(valueParts.join('=') || '');
            }
        }

        return '';
    }

    static async me(req: Request, res: Response, next: NextFunction) {
        try {
            // req.user is set by auth middleware — return fresh user data
            res.json({
                success: true,
                data: req.user
            });
        } catch {
            next({ statusCode: 401, message: 'Sesión inválida' });
        }
    }

    static async register(req: Request, res: Response, next: NextFunction) {
        try {
            const { name, email, username, password, roleId, branchId, companyId } = req.body;
            const requestUser = req.user;
            if (!requestUser) {
                return next({ statusCode: 401, message: 'No autenticado' });
            }
            // Input validation
            if (!name || typeof name !== 'string' || name.length > 100) {
                return next({ statusCode: 400, message: 'Nombre válido requerido (máx. 100 caracteres)' });
            }
            if (!email || typeof email !== 'string' || !email.includes('@')) {
                return next({ statusCode: 400, message: 'Email válido requerido' });
            }
            if (!username || typeof username !== 'string' || username.length < 3 || username.length > 50) {
                return next({ statusCode: 400, message: 'El usuario debe tener entre 3 y 50 caracteres' });
            }
            if (!password || typeof password !== 'string') {
                return next({ statusCode: 400, message: 'Contraseña requerida' });
            }
            if (!roleId || typeof roleId !== 'number') {
                return next({ statusCode: 400, message: 'roleId válido requerido' });
            }
            const isSuperAdmin = requestUser.roles?.includes('SUPERADMIN') || requestUser.role === 'SUPERADMIN';
            const resolvedCompanyId = isSuperAdmin ? companyId : requestUser.companyId;
            if (!resolvedCompanyId || typeof resolvedCompanyId !== 'number') {
                return next({ statusCode: 400, message: 'companyId válido requerido' });
            }
            // Only pass allowed fields — prevent mass assignment
            const user = await AuthService.register({
                name,
                email,
                username,
                password,
                roleId,
                branchId,
                companyId: resolvedCompanyId
            });
            res.status(201).json({
                success: true,
                message: 'Usuario registrado exitosamente',
                data: user
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async login(req: Request, res: Response, next: NextFunction) {
        try {
            const { username, password, twoFactorCode } = req.body;

            if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
                return next({ statusCode: 400, message: 'Usuario y contraseña son requeridos' });
            }
            // Prevent DoS via extremely long passwords (bcrypt max effective is 72 bytes)
            if (password.length > 128 || username.length > 100) {
                return next({ statusCode: 400, message: 'Credenciales inválidas' });
            }

            const ip = req.ip || req.headers['x-forwarded-for'] as string || '';
            const ua = req.headers['user-agent'] || '';
            const result = await AuthService.login(username, password, twoFactorCode, ip, ua);

            if (result && 'token' in result && result.token) {
                const isSecure = process.env.NODE_ENV === 'production';
                res.cookie('auth_token', result.token, {
                    httpOnly: true,
                    secure: isSecure,
                    sameSite: 'lax',
                    maxAge: 8 * 60 * 60 * 1000,
                    path: '/'
                });
            }

            res.json({ success: true, message: 'Inicio de sesión exitoso', data: result });
        } catch (error) {
            next({ statusCode: 401, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async changePassword(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            if (!userId) return next({ statusCode: 401, message: 'No autenticado' });

            const { oldPassword, newPassword } = req.body;
            if (!oldPassword || !newPassword) {
                return next({ statusCode: 400, message: 'Contraseña actual y nueva son requeridas' });
            }

            await AuthService.changePassword(userId, oldPassword, newPassword);
            res.json({ success: true, message: 'Contraseña actualizada exitosamente' });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    // ── Sessions ──
    static async getSessions(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const sessions = await SessionService.listActive(userId);
            const currentToken = AuthController.extractToken(req);
            const currentHash = SessionService.hashToken(currentToken);
            const data = sessions.map((s: { tokenHash: string; id: string; device: string | null; ipAddress: string | null; createdAt: Date }) => {
                const { tokenHash, ...rest } = s;
                return { ...rest, isCurrent: tokenHash === currentHash };
            });
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async revokeSession(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            await SessionService.revoke(req.params.id, userId);
            res.json({ success: true, message: 'Sesión cerrada' });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async revokeAllSessions(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const token = AuthController.extractToken(req);
            await SessionService.revokeAllExcept(userId, token);
            res.clearCookie('auth_token', { path: '/' });
            res.json({ success: true, message: 'Otras sesiones cerradas' });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    // ── 2FA ──
    static async setup2FA(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const data = await TwoFactorService.setup(userId);
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async verify2FA(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const { code } = req.body;
            if (!code) return next({ statusCode: 400, message: 'Código requerido' });
            const data = await TwoFactorService.verify(userId, code);
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async disable2FA(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const { code } = req.body;
            if (!code) return next({ statusCode: 400, message: 'Código requerido' });
            const data = await TwoFactorService.disable(userId, code);
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }
}
