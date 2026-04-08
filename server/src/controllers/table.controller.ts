import { Request, Response, NextFunction } from 'express';
import { TableService } from '../services/table.service';
import { WebSocketService } from '../services/websocket.service';
import { getErrorMessage } from '../utils/error';

export class TableController {
    private static resolveBranchScope(req: Request, requestedBranchId?: number): number | undefined {
        const isSuperAdmin = req.user?.role === 'SUPERADMIN';
        if (isSuperAdmin) {
            return requestedBranchId;
        }

        const userBranchId = req.user?.branchId;
        if (!userBranchId) {
            throw new Error('Usuario sin sucursal asignada');
        }

        if (requestedBranchId && requestedBranchId !== userBranchId) {
            throw new Error('No autorizado para consultar otra sucursal');
        }

        return userBranchId;
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const currentRole = req.user?.role;
            let branchId: number | undefined;
            if (req.user?.role === 'SUPERADMIN') {
                branchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            } else {
                branchId = req.user?.branchId;
            }
            let tables = await TableService.getAll(companyId, branchId);

            // Defensive fallback:
            // if branch-scoped users (e.g. waiter/host/cashier) get an empty list due
            // inconsistent branch assignment, return company tables so POS remains operable.
            if (
                tables.length === 0 &&
                branchId &&
                !req.query.branchId &&
                currentRole &&
                ['MESERO', 'HOST', 'CAJERO'].includes(currentRole)
            ) {
                tables = await TableService.getAll(companyId, undefined);
            }
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const table = await TableService.getById(id, companyId);
            res.json({
                success: true,
                data: table
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getByBranch(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = parseInt(req.params.branchId);
            const companyId = req.user!.companyId;
            const branchId = TableController.resolveBranchScope(req, requestedBranchId);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            const tables = await TableService.getByBranch(branchId, companyId);
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
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
            req.body.branchId = TableController.resolveBranchScope(req, Number(req.body.branchId));

            const table = await TableService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Mesa creada exitosamente',
                data: table
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const table = await TableService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Mesa actualizada exitosamente',
                data: table
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await TableService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Mesa eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { status } = req.body;

            if (!status) {
                return next({ statusCode: 400, message: 'Estado es requerido' });
            }

            const table = await TableService.updateStatus(id, companyId, status);

            // Broadcast table status change
            WebSocketService.broadcastTableUpdate(id, status, table, {
                companyId,
                branchId: table.branchId
            });

            res.json({
                success: true,
                message: 'Estado de mesa actualizado exitosamente',
                data: table
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
