import { Request, Response, NextFunction } from 'express';
import { PermissionService } from '../services/permission.service';
import { getErrorMessage } from '../utils/error';

export class PermissionController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const permissions = await PermissionService.getAll();
            res.json({
                success: true,
                data: permissions
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const permission = await PermissionService.getById(id);
            res.json({
                success: true,
                data: permission
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const permission = await PermissionService.create(req.body);
            res.json({
                success: true,
                data: permission
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const permission = await PermissionService.update(id, req.body);
            res.json({
                success: true,
                data: permission
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            await PermissionService.delete(id);
            res.json({
                success: true,
                message: 'Permiso eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
