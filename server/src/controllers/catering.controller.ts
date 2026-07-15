import { Request, Response, NextFunction } from 'express';
import { CateringStatus } from '@prisma/client';
import { CateringService } from '../services/catering.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, isCompanyWide, BranchScopeError } from '../utils/branch-scope';

const CATERING_STATUSES: readonly CateringStatus[] = [
    'QUOTED',
    'RESERVED',
    'PAID',
    'FINISHED',
    'CANCELLED',
] as const;

function parseCateringStatus(value: unknown): CateringStatus | undefined {
    if (typeof value !== 'string') return undefined;
    return (CATERING_STATUSES as readonly string[]).includes(value) ? (value as CateringStatus) : undefined;
}

export class CateringController {

    /** Load a catering event and assert the caller's branch may access it. */
    private static async assertEventBranch(req: Request, eventId: number) {
        const event = await CateringService.getEventById(eventId, req.user!.companyId);
        assertBranchAccess(req.user!, (event as { branchId: number | null }).branchId, { allowGlobal: true });
        return event;
    }

    static async getAllEvents(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const filters = {
                branchId: resolveBranchScope(req.user!, requested),
                status: parseCateringStatus(req.query.status),
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            const events = await CateringService.getAllEvents(companyId, filters);
            res.json({ success: true, data: events });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getEventById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const event = await CateringController.assertEventBranch(req, id);
            res.json({ success: true, data: event });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async createEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            // Non-superadmin users create events only in their active branch.
            if (!isCompanyWide(req.user!)) {
                if (!req.user!.branchId) {
                    return next({ statusCode: 400, message: 'Su usuario no tiene una sucursal activa asignada.' });
                }
                req.body.branchId = req.user!.branchId;
            }
            const event = await CateringService.createEvent(companyId, userId, req.body);
            res.status(201).json({ success: true, data: event });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            await CateringController.assertEventBranch(req, id);
            if (req.body.branchId !== undefined && req.body.branchId !== null) {
                assertBranchAccess(req.user!, Number(req.body.branchId), { allowGlobal: true });
            }
            const event = await CateringService.updateEvent(id, companyId, userId, req.body);
            res.json({ success: true, data: event });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CateringController.assertEventBranch(req, id);
            await CateringService.deleteEvent(id, companyId, req.user!.userId);
            res.json({ success: true, message: 'Evento eliminado exitosamente' });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addPayment(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CateringController.assertEventBranch(req, id);
            const rawIdempotencyKey = req.headers['x-idempotency-key'];
            const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey : undefined;
            const payment = await CateringService.addPayment(
                id,
                companyId,
                req.user!.userId,
                { ...req.body, idempotencyKey }
            );
            res.status(201).json({ success: true, data: payment });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async reversePayment(req: Request, res: Response, next: NextFunction) {
        try {
            const eventId = parseInt(req.params.id);
            const paymentId = parseInt(req.params.paymentId);
            await CateringController.assertEventBranch(req, eventId);
            const payment = await CateringService.reversePayment(
                eventId,
                paymentId,
                req.user!.companyId,
                req.user!.userId,
                req.body.reason
            );
            res.json({ success: true, data: payment });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    // Services Catalog
    static async getAllServices(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const services = await CateringService.getAllServices(companyId);
            res.json({ success: true, data: services });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async createService(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const service = await CateringService.createService(companyId, req.body);
            res.status(201).json({ success: true, data: service });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateService(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const service = await CateringService.updateService(id, companyId, req.body);
            res.json({ success: true, data: service });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteService(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CateringService.deleteService(id, companyId);
            res.json({ success: true, message: 'Servicio eliminado exitosamente' });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async checkAvailability(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const date = new Date(req.query.date as string);
            const requested = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const result = await CateringService.checkResourceAvailability(date, companyId, branchId);
            res.json({ success: true, data: result });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
