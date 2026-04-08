import { Request, Response, NextFunction } from 'express';
import { CateringStatus } from '@prisma/client';
import { CateringService } from '../services/catering.service';
import { getErrorMessage } from '../utils/error';

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

    static async getAllEvents(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = {
                branchId: req.query.branchId ? parseInt(req.query.branchId as string) : undefined,
                status: parseCateringStatus(req.query.status),
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            const events = await CateringService.getAllEvents(companyId, filters);
            res.json({ success: true, data: events });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getEventById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const event = await CateringService.getEventById(id, companyId);
            res.json({ success: true, data: event });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async createEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            const event = await CateringService.createEvent(companyId, userId, req.body);
            res.status(201).json({ success: true, data: event });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            const event = await CateringService.updateEvent(id, companyId, userId, req.body);
            res.json({ success: true, data: event });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CateringService.deleteEvent(id, companyId);
            res.json({ success: true, message: 'Evento eliminado exitosamente' });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addPayment(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const payment = await CateringService.addPayment(id, companyId, req.body);
            res.status(201).json({ success: true, data: payment });
        } catch (error: unknown) {
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
            const result = await CateringService.checkResourceAvailability(date, companyId);
            res.json({ success: true, data: result });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
