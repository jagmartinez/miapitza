import { Request, Response, NextFunction } from 'express';
import { ADMINS } from '../constants/roles';
import { CashRegisterService } from '../services/cash-register.service';
import { getErrorMessage } from '../utils/error';

export class CashRegisterController {

    private static isCompanyWide(req: Request): boolean {
        const roles = req.user!.roles ?? [req.user!.role];
        return roles.some((r) => (ADMINS as readonly string[]).includes(r));
    }

    // Non company-wide roles can only see/operate registers of their own branch.
    private static assertRegisterBranchAccess(req: Request, register: { branchId: number }) {
        if (CashRegisterController.isCompanyWide(req)) return;
        if (!req.user!.branchId || register.branchId !== req.user!.branchId) {
            throw new Error('No autorizado: la caja pertenece a otra sucursal');
        }
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            // Company managers may scope by an explicit branch (or see all);
            // other roles are pinned to their own branch regardless of query.
            const branchId = CashRegisterController.isCompanyWide(req)
                ? (req.query.branchId ? parseInt(req.query.branchId as string) : undefined)
                : req.user?.branchId;

            const registers = await CashRegisterService.getAll(companyId, branchId);
            res.json({
                success: true,
                data: registers
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const register = await CashRegisterService.getById(id, companyId);
            CashRegisterController.assertRegisterBranchAccess(req, register as { branchId: number });
            res.json({
                success: true,
                data: register
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getActiveShift(req: Request, res: Response, next: NextFunction) {
        try {
            const cashRegisterId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const register = await CashRegisterService.getById(cashRegisterId, companyId);
            CashRegisterController.assertRegisterBranchAccess(req, register as { branchId: number });
            const shift = await CashRegisterService.getActiveShift(companyId, cashRegisterId);
            res.json({
                success: true,
                data: shift
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Ensure branchId is set - use from body if provided, otherwise use user's branchId
            if (!req.body.branchId) {
                if (!req.user?.branchId) {
                    return next({ statusCode: 400, message: 'ID de sucursal requerido' });
                }
                req.body.branchId = req.user.branchId;
            }

            const register = await CashRegisterService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Caja registradora creada exitosamente',
                data: register
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const register = await CashRegisterService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Caja registradora actualizada exitosamente',
                data: register
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CashRegisterService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Caja registradora eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
