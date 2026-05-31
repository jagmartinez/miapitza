import { Request, Response, NextFunction } from 'express';
import { CashShiftService } from '../services/cash-shift.service';
import { getErrorMessage } from '../utils/error';

export class CashShiftController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type CashShiftFilters = NonNullable<Parameters<typeof CashShiftService.getAll>[1]>;
            const filters: CashShiftFilters = {};

            if (req.query.cashRegisterId) {
                filters.cashRegisterId = parseInt(req.query.cashRegisterId as string);
            }

            if (req.query.userId) {
                filters.userId = parseInt(req.query.userId as string);
            }

            if (req.query.status) {
                const s = req.query.status as string;
                if (s === 'OPEN' || s === 'CLOSED') {
                    filters.status = s;
                }
            }

            if (req.query.startDate) {
                filters.startDate = req.query.startDate as string;
            }

            if (req.query.endDate) {
                filters.endDate = req.query.endDate as string;
            }

            const shifts = await CashShiftService.getAll(companyId, filters);
            res.json({
                success: true,
                data: shifts
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const shift = await CashShiftService.getById(id, companyId);
            res.json({
                success: true,
                data: shift
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getSummary(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const summary = await CashShiftService.getShiftSummary(id, companyId);
            res.json({
                success: true,
                data: summary
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async open(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;

            if (!req.body.cashRegisterId) {
                return next({ statusCode: 400, message: 'cashRegisterId es requerido' });
            }

            if (req.body.startAmount === undefined || req.body.startAmount === null) {
                return next({ statusCode: 400, message: 'startAmount es requerido' });
            }

            const data = {
                cashRegisterId: parseInt(req.body.cashRegisterId),
                userId: userId,
                startAmount: parseFloat(req.body.startAmount)
            };

            // Require a branch scope. Non-SUPERADMIN users must have an assigned
            // branch; SUPERADMIN may target a branch explicitly via the request body.
            // Never silently fall back to branch 0.
            let branchId = req.user!.branchId;
            if (!branchId) {
                if (req.user!.role === 'SUPERADMIN' && req.body.branchId) {
                    branchId = parseInt(req.body.branchId);
                } else {
                    return next({ statusCode: 400, message: 'ID de sucursal requerido' });
                }
            }

            const shift = await CashShiftService.open(companyId, branchId, data);
            res.status(201).json({
                success: true,
                message: 'Turno de caja abierto exitosamente',
                data: shift
            });
        } catch (error: unknown) {
            console.error('[CASH-SHIFT] Error opening shift:', getErrorMessage(error));
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async close(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { closingBalance, notes } = req.body;

            if (closingBalance === undefined) {
                return next({ statusCode: 400, message: 'closingBalance es requerido' });
            }

            const shift = await CashShiftService.close(id, companyId, closingBalance, notes);
            res.json({
                success: true,
                message: 'Turno de caja cerrado exitosamente',
                data: shift
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addMovement(req: Request, res: Response, next: NextFunction) {
        try {
            const shiftId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const movement = await CashShiftService.addMovement(shiftId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Movimiento agregado exitosamente',
                data: movement
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteMovement(req: Request, res: Response, next: NextFunction) {
        try {
            const movementId = parseInt(req.params.movementId);
            const companyId = req.user!.companyId;
            await CashShiftService.deleteMovement(movementId, companyId);
            res.json({
                success: true,
                message: 'Movimiento eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getActiveStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const companyId = req.user!.companyId;
            const status = await CashShiftService.getActiveShiftStatus(userId, companyId);
            res.json({
                success: true,
                data: status
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
