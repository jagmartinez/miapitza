import { Request, Response, NextFunction } from 'express';
import { RoleService } from '../services/role.service';
import { getErrorMessage } from '../utils/error';

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
            next({ statusCode: 500, message: getErrorMessage(error) });
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
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const role = await RoleService.create(companyId, req.body);
            res.json({
                success: true,
                data: role
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const role = await RoleService.update(id, companyId, req.body);
            res.json({
                success: true,
                data: role
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
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
