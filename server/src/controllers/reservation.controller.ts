import { Request, Response, NextFunction } from 'express';
import { ReservationService } from '../services/reservation.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, BranchScopeError, isCompanyWide, resolveBranchScope } from '../utils/branch-scope';

export class ReservationController {
    private static resolveBranchScope(req: Request, requestedBranchId?: number): number | undefined {
        return resolveBranchScope(req.user!, requestedBranchId);
    }

    private static async assertReservationBranch(req: Request, id: number) {
        const reservation = await ReservationService.getById(id, req.user!.companyId);
        assertBranchAccess(req.user!, reservation.branchId);
        return reservation;
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type ReservationFilters = NonNullable<Parameters<typeof ReservationService.getAll>[1]>;
            const filters: ReservationFilters = {};

            if (isCompanyWide(req.user!)) {
                if (req.query.branchId) {
                    filters.branchId = parseInt(req.query.branchId as string);
                }
            } else {
                filters.branchId = req.user?.branchId;
            }

            if (req.query.status) {
                const s = req.query.status as string;
                if (
                    s === 'PENDING' ||
                    s === 'CONFIRMED' ||
                    s === 'CANCELLED' ||
                    s === 'NO_SHOW' ||
                    s === 'COMPLETED'
                ) {
                    filters.status = s;
                }
            }

            if (req.query.date) {
                filters.date = new Date(req.query.date as string);
            }

            const reservations = await ReservationService.getAll(companyId, filters);
            res.json({
                success: true,
                data: reservations
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const reservation = await ReservationController.assertReservationBranch(req, id);
            res.json({
                success: true,
                data: reservation
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getByBranch(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = parseInt(req.params.branchId);
            const companyId = req.user!.companyId;
            const branchId = ReservationController.resolveBranchScope(req, requestedBranchId);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            const date = req.query.date ? new Date(req.query.date as string) : undefined;

            const reservations = await ReservationService.getByBranch(branchId, companyId, date);
            res.json({
                success: true,
                data: reservations
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getTodayReservations(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = ReservationController.resolveBranchScope(req, requestedBranchId);
            const reservations = await ReservationService.getTodayReservations(companyId, branchId);
            res.json({
                success: true,
                data: reservations
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getUpcoming(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = ReservationController.resolveBranchScope(req, requestedBranchId);
            const days = req.query.days ? parseInt(req.query.days as string) : 7;
            if (!Number.isInteger(days) || days < 1 || days > 365) {
                return next({ statusCode: 400, message: 'days debe ser un entero entre 1 y 365' });
            }

            const reservations = await ReservationService.getUpcomingReservations(companyId, branchId, days);
            res.json({
                success: true,
                data: reservations
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
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
            req.body.branchId = ReservationController.resolveBranchScope(req, Number(req.body.branchId));

            // Convert date string to Date object
            const data = {
                ...req.body,
                date: new Date(req.body.date)
            };

            const reservation = await ReservationService.create(companyId, data);
            res.status(201).json({
                success: true,
                message: 'Reservación creada exitosamente',
                data: reservation
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ReservationController.assertReservationBranch(req, id);

            // Whitelist updatable fields. `status` is excluded on purpose; status
            // changes must go through updateStatus() which validates transitions.
            const { customerName, phone, email, date, peopleCount, notes } = req.body;
            const data: Parameters<typeof ReservationService.update>[2] = {};
            if (customerName !== undefined) data.customerName = customerName;
            if (phone !== undefined) data.phone = phone;
            if (email !== undefined) data.email = email;
            if (notes !== undefined) data.notes = notes;
            if (peopleCount !== undefined) data.peopleCount = peopleCount;
            if (date !== undefined) data.date = new Date(date);

            const reservation = await ReservationService.update(id, companyId, data);
            res.json({
                success: true,
                message: 'Reservación actualizada exitosamente',
                data: reservation
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ReservationController.assertReservationBranch(req, id);
            const { status } = req.body;

            if (!status) {
                return next({ statusCode: 400, message: 'Estado es requerido' });
            }

            const reservation = await ReservationService.updateStatus(id, companyId, status);
            res.json({
                success: true,
                message: 'Estado de reservación actualizado exitosamente',
                data: reservation
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ReservationController.assertReservationBranch(req, id);
            await ReservationService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Reservación eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async checkIn(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ReservationController.assertReservationBranch(req, id);
            const result = await ReservationService.checkIn(id, companyId, req.user!.userId);
            res.json({
                success: true,
                message: 'Check-in realizado y orden POS creada exitosamente',
                data: result
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getAvailableTables(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = parseInt(req.params.branchId);
            const companyId = req.user!.companyId;
            const branchId = ReservationController.resolveBranchScope(req, requestedBranchId);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            const date = new Date(req.query.date as string);
            const peopleCount = parseInt(req.query.peopleCount as string);

            if (!date || !peopleCount) {
                return next({ statusCode: 400, message: 'Fecha y cantidad de personas son requeridos' });
            }

            const tables = await ReservationService.getAvailableTables(branchId, companyId, date, peopleCount);
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
