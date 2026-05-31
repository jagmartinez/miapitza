import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { getErrorMessage } from '../utils/error';

export class UserController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            const userRoles = req.user?.roles || [req.user?.role];
            if (userRoles.includes('SUPERADMIN') && req.query.companyId) {
                companyId = parseInt(req.query.companyId as string);
            }
            const users = await UserService.getAll(companyId);
            res.json({
                success: true,
                data: users
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const user = await UserService.getById(id, companyId);
            res.json({
                success: true,
                data: user
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const actingRoles = req.user!.roles || [req.user!.role];
            const user = await UserService.update(id, companyId, req.body, actingRoles);
            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente',
                data: user
            });
        } catch (error: unknown) {
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
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await UserService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Usuario eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            const cRoles = req.user?.roles || [req.user?.role];
            if (cRoles.includes('SUPERADMIN') && req.body.companyId) {
                companyId = parseInt(req.body.companyId);
            }
            const actingRoles = req.user?.roles || [req.user?.role as string];
            const user = await UserService.create(companyId, req.body, actingRoles);
            res.status(201).json({
                success: true,
                message: 'Usuario creado exitosamente',
                data: user
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
