import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { getErrorMessage } from '../utils/error';
import {
    isPlatformOperator,
    parseCompanyIdInput,
    resolveActingCompanyId,
    TenantScopeError,
} from '../utils/tenant-scope';

export class UserController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = parseCompanyIdInput(req.query?.companyId);
            const companyId = await resolveActingCompanyId(req.user!, requested);
            const users = await UserService.getAll(companyId);
            res.json({
                success: true,
                data: users
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const actingRoles = req.user!.roles || [req.user!.role];
            const mayReadOtherUsers = actingRoles.some((role) => role === 'ADMIN' || role === 'SUPERADMIN');
            if (id !== req.user!.userId && !mayReadOtherUsers) {
                return next({ statusCode: 403, message: 'No autorizado para consultar otro usuario' });
            }
            const companyId = await UserController.resolveUserCompany(req, id);
            const user = await UserService.getById(id, companyId);
            res.json({
                success: true,
                data: user
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getProfile(req: Request, res: Response, next: NextFunction) {
        try {
            const user = await UserService.getById(req.user!.userId, req.user!.companyId);
            res.json({ success: true, data: user });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await UserController.resolveUserCompany(req, id);
            const actingRoles = req.user!.roles || [req.user!.role];
            const user = await UserService.update(
                id,
                companyId,
                req.body,
                actingRoles,
                req.user!.userId,
            );
            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente',
                data: user
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateMe(req: Request, res: Response, next: NextFunction) {
        try {
            const id = req.user!.userId;
            const companyId = req.user!.companyId;
            // Prevent users from changing their own role or status through this endpoint
            const updateData = { ...req.body };
            delete updateData.roleId;
            delete updateData.roleIds;
            delete updateData.status;
            delete updateData.companyId;
            delete updateData.accountType;
            // Password changes must go through /auth/change-password so the
            // current password is verified and all existing sessions are revoked.
            delete updateData.password;
            // Branch assignment/rotation is a SUPERADMIN-only action, never self-service.
            delete updateData.branchId;
            delete updateData.branchIds;

            const user = await UserService.update(id, companyId, updateData);
            res.json({
                success: true,
                message: 'Perfil actualizado exitosamente',
                data: user
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await UserController.resolveUserCompany(req, id);
            await UserService.delete(
                id,
                companyId,
                req.user!.roles || [req.user!.role],
                req.user!.userId,
            );
            res.json({
                success: true,
                message: 'Usuario eliminado exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = parseCompanyIdInput(req.body.companyId);
            const companyId = await resolveActingCompanyId(req.user!, requested, {
                requireActiveTarget: true,
            });
            const actingRoles = req.user?.roles || [req.user?.role as string];
            const user = await UserService.create(
                companyId,
                req.body,
                actingRoles,
            );
            res.status(201).json({
                success: true,
                message: 'Usuario creado exitosamente',
                data: user
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    /**
     * Home-company actors are pinned to `req.user.companyId`.
     * Platform operators may manage a user owned by another company by id.
     */
    private static async resolveUserCompany(req: Request, userId: number): Promise<number> {
        if (!isPlatformOperator(req.user!)) {
            return req.user!.companyId;
        }
        const requested = parseCompanyIdInput(req.query?.companyId ?? req.body?.companyId);
        if (requested !== undefined) {
            return resolveActingCompanyId(req.user!, requested);
        }
        const ownerCompanyId = await UserService.getCompanyIdById(userId);
        if (ownerCompanyId == null) {
            throw new TenantScopeError('Usuario no encontrado');
        }
        return resolveActingCompanyId(req.user!, ownerCompanyId);
    }
}
