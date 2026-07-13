import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { CashShiftService } from '../services/cash-shift.service';
import { CashArqueoService } from '../services/cash-arqueo.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, isCompanyWide, resolveBranchScope } from '../utils/branch-scope';

export class CashShiftController {

    private static isCompanyWide(req: Request): boolean {
        return isCompanyWide(req.user!);
    }

    // Company managers (SUPERADMIN/ADMIN) operate across branches. Other roles
    // (e.g. CAJERO) may only touch shifts of their own branch.
    private static async assertShiftBranchAccess(req: Request, shiftId: number) {
        const shift = await prisma.cashShift.findFirst({
            where: { id: shiftId, companyId: req.user!.companyId },
            select: { cashRegister: { select: { branchId: true } } }
        });
        if (!shift) throw new Error('Turno de caja no encontrado');
        assertBranchAccess(req.user!, shift.cashRegister.branchId);
    }

    private static async assertMovementBranchAccess(req: Request, movementId: number) {
        const movement = await prisma.cashMovement.findFirst({
            where: { id: movementId, shift: { companyId: req.user!.companyId } },
            select: { shift: { select: { cashRegister: { select: { branchId: true } } } } }
        });
        if (!movement) throw new Error('Movimiento no encontrado');
        assertBranchAccess(req.user!, movement.shift.cashRegister.branchId);
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type CashShiftFilters = NonNullable<Parameters<typeof CashShiftService.getAll>[1]>;
            const filters: CashShiftFilters = {};

            // Non company-wide roles are restricted to their own branch.
            filters.branchId = resolveBranchScope(
                req.user!,
                req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined
            );

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
            await CashShiftController.assertShiftBranchAccess(req, id);
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
            await CashShiftController.assertShiftBranchAccess(req, id);
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

            const cashRegisterId = parseInt(String(req.body.cashRegisterId), 10);
            if (Number.isNaN(cashRegisterId)) {
                return next({ statusCode: 400, message: 'cashRegisterId inválido' });
            }

            const register = await prisma.cashRegister.findFirst({
                where: { id: cashRegisterId, companyId },
                select: { id: true, branchId: true, name: true }
            });

            if (!register) {
                return next({ statusCode: 400, message: 'Caja registradora no encontrada' });
            }

            assertBranchAccess(req.user!, register.branchId);

            const startAmount = parseFloat(String(req.body.startAmount));
            if (Number.isNaN(startAmount) || startAmount < 0) {
                return next({ statusCode: 400, message: 'startAmount inválido' });
            }

            const data = {
                cashRegisterId,
                userId,
                startAmount
            };

            const shift = await CashShiftService.open(companyId, register.branchId, data);
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

            await CashShiftController.assertShiftBranchAccess(req, id);
            const shift = await CashArqueoService.closeShiftWithArqueo(
                id,
                companyId,
                Number(closingBalance),
                req.user!.roles || [req.user!.role],
                notes,
                undefined,
                { forceClose: req.body.forceClose === true }
            );
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
            await CashShiftController.assertShiftBranchAccess(req, shiftId);
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
            await CashShiftController.assertMovementBranchAccess(req, movementId);
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
