import { Request, Response, NextFunction } from 'express';
import { ModifierService } from '../services/modifier.service';
import { getErrorMessage } from '../utils/error';
import { MenuItemService } from '../services/menu-item.service';
import { assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class ModifierController {

    static async getAllGroups(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const groups = await ModifierService.getAll(companyId);
            res.json({
                success: true,
                data: groups
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async createGroup(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const group = await ModifierService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Grupo de modificadores creado exitosamente',
                data: group
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateGroup(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const group = await ModifierService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Grupo de modificadores actualizado exitosamente',
                data: group
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async createModifier(req: Request, res: Response, next: NextFunction) {
        try {
            const { groupId, ...data } = req.body;
            const companyId = req.user!.companyId;
            const modifier = await ModifierService.addModifier(companyId, groupId, data);
            res.status(201).json({
                success: true,
                message: 'Modificador creado exitosamente',
                data: modifier
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateModifier(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const modifier = await ModifierService.updateModifier(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Modificador actualizado exitosamente',
                data: modifier
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteModifier(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ModifierService.deleteModifier(id, companyId);
            res.json({
                success: true,
                message: 'Modificador eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async assignGroupToMenuItem(req: Request, res: Response, next: NextFunction) {
        try {
            const { menuItemId, groupId } = req.body;
            const companyId = req.user!.companyId;
            assertBranchAccess(req.user!, await MenuItemService.getOwnerBranch(Number(menuItemId), companyId));
            await ModifierService.assignGroupToMenuItem(menuItemId, groupId, companyId);
            res.json({
                success: true,
                message: 'Grupo asignado al platillo exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async removeGroupFromMenuItem(req: Request, res: Response, next: NextFunction) {
        try {
            const { menuItemId, groupId } = req.body;
            const companyId = req.user!.companyId;
            assertBranchAccess(req.user!, await MenuItemService.getOwnerBranch(Number(menuItemId), companyId));
            await ModifierService.removeGroupFromMenuItem(menuItemId, groupId, companyId);
            res.json({
                success: true,
                message: 'Grupo removido del platillo exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
