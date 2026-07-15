import { Request, Response, NextFunction } from 'express';
import { RoleService, RoleServiceError } from '../services/role.service';
import { getErrorMessage } from '../utils/error';

function handleRoleError(error: unknown, next: NextFunction): void {
    if (error instanceof RoleServiceError) {
        next(error);
        return;
    }
    next({ statusCode: 500, message: getErrorMessage(error) });
}

export class RoleController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const roles = await RoleService.getAll(companyId);
            res.json({
                success: true,
                data: roles
            });
        } catch (error: unknown) {
            handleRoleError(error, next);
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const role = await RoleService.getById(id, companyId);
            res.json({
                success: true,
                data: role
            });
        } catch (error: unknown) {
            handleRoleError(error, next);
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const role = await RoleService.create(
                companyId,
                req.body,
                req.user!.userId,
                req.user!.roles || [req.user!.role]
            );
            res.json({
                success: true,
                data: role
            });
        } catch (error: unknown) {
            handleRoleError(error, next);
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const role = await RoleService.update(
                id,
                companyId,
                req.body,
                req.user!.userId,
                req.user!.roles || [req.user!.role]
            );
            res.json({
                success: true,
                data: role
            });
        } catch (error: unknown) {
            handleRoleError(error, next);
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await RoleService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Rol eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
