import { Request, Response, NextFunction } from 'express';
import { ReservationService } from '../services/reservation.service';
import { getErrorMessage } from '../utils/error';

export class ReservationController {
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
            type ReservationFilters = NonNullable<Parameters<typeof ReservationService.getAll>[1]>;
            const filters: ReservationFilters = {};

            if (req.user?.role === 'SUPERADMIN') {
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
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const reservation = await ReservationService.getById(id, companyId);
            res.json({
                success: true,
                data: reservation
            });
        } catch (error: unknown) {
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
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getUpcoming(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = ReservationController.resolveBranchScope(req, requestedBranchId);
            const days = req.query.days ? parseInt(req.query.days as string) : 7;

            const reservations = await ReservationService.getUpcomingReservations(companyId, branchId, days);
            res.json({
                success: true,
                data: reservations
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
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;

            // Convert date string to Date object if provided
            const data = {
                ...req.body
            };

            if (data.date) {
                data.date = new Date(data.date);
            }

            const reservation = await ReservationService.update(id, companyId, data);
            res.json({
                success: true,
                message: 'Reservación actualizada exitosamente',
                data: reservation
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

            const reservation = await ReservationService.updateStatus(id, companyId, status);
            res.json({
                success: true,
                message: 'Estado de reservación actualizado exitosamente',
                data: reservation
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ReservationService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Reservación eliminada exitosamente'
            });
        } catch (error: unknown) {
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
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
