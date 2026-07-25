import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
    HolidayService,
    HrScheduleError,
    ShiftSwapService,
    ShiftTemplateService,
    WeeklyScheduleService,
    type ScheduledShiftInput,
} from '../services/hr-schedule.service';
import { BranchScopeError, resolveBranchScope } from '../utils/branch-scope';

function queryId(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function queryText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function queryBoolean(value: unknown): boolean | undefined {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return undefined;
}

function branchScope(req: Request, requested?: number): number | undefined {
    return resolveBranchScope(req.user!, requested);
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof HrScheduleError || error instanceof BranchScopeError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Ya existe un registro equivalente o hubo una actualización concurrente' });
            return;
        }
        if (error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'La referencia indicada no es válida' });
            return;
        }
    }
    next(error);
}

export class HrScheduleController {
    static async scheduleLookups(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.listLookups(
                req.user!.companyId,
                String(req.query.weekStart),
                branchScope(req),
            );
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async listTemplates(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftTemplateService.list(req.user!.companyId, {
                branchId: queryId(req.query.branchId),
                active: queryBoolean(req.query.active),
            }, branchScope(req, queryId(req.query.branchId)));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async getTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftTemplateService.getById(Number(req.params.id), req.user!.companyId, branchScope(req));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async createTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftTemplateService.create(req.user!.companyId, req.body, req.user!.userId, branchScope(req, Number(req.body.branchId)));
            res.status(201).json({ success: true, data, message: 'Plantilla de turno creada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async updateTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftTemplateService.update(Number(req.params.id), req.user!.companyId, req.body, req.user!.userId, branchScope(req));
            res.json({ success: true, data, message: 'Plantilla de turno actualizada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async deleteTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftTemplateService.remove(
                Number(req.params.id),
                req.user!.companyId,
                req.query.expectedRevision,
                req.user!.userId,
                branchScope(req),
            );
            res.json({ success: true, data, message: 'Plantilla de turno desactivada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async listSchedules(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.list(req.user!.companyId, {
                weekStart: queryText(req.query.weekStart), status: queryText(req.query.status),
                branchId: queryId(req.query.branchId), userId: queryId(req.query.userId),
                jobPositionId: queryId(req.query.jobPositionId),
            }, branchScope(req, queryId(req.query.branchId)));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async getSchedule(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.getById(Number(req.params.id), req.user!.companyId, branchScope(req));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async createDraft(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.createDraft(req.user!.companyId, req.body, req.user!.userId, branchScope(req));
            res.status(201).json({ success: true, data, message: 'Borrador de agenda creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async replaceShifts(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.replaceDraftShifts(
                Number(req.params.id), req.user!.companyId,
                { expectedRevision: req.body.expectedRevision, shifts: req.body.shifts as ScheduledShiftInput[], notes: req.body.notes },
                req.user!.userId, branchScope(req),
            );
            res.json({ success: true, data, message: 'Turnos del borrador actualizados' });
        } catch (error) { handleError(error, res, next); }
    }

    static async copySchedule(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.copy(Number(req.params.id), req.user!.companyId, req.body.targetWeekStart, req.user!.userId, branchScope(req));
            res.status(201).json({ success: true, data, message: 'Agenda copiada como borrador' });
        } catch (error) { handleError(error, res, next); }
    }

    static async publishSchedule(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.publish(Number(req.params.id), req.user!.companyId, Number(req.body.expectedRevision), req.user!.userId, branchScope(req));
            res.json({ success: true, data, message: 'Agenda publicada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async cancelSchedule(req: Request, res: Response, next: NextFunction) {
        try {
            await WeeklyScheduleService.cancel(Number(req.params.id), req.user!.companyId, Number(req.body.expectedRevision), req.user!.userId, branchScope(req));
            res.json({ success: true, message: 'Agenda cancelada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async acknowledge(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.acknowledge(Number(req.params.id), req.user!.companyId, req.user!.userId);
            res.json({ success: true, data, message: 'Agenda confirmada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async mySchedule(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WeeklyScheduleService.getMySchedule(req.user!.companyId, req.user!.userId, String(req.query.weekStart));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async teamSchedule(req: Request, res: Response, next: NextFunction) {
        try {
            const schedule = await WeeklyScheduleService.getTeamSchedule(
                req.user!.companyId,
                req.user!.userId,
                String(req.query.weekStart),
                branchScope(req),
            );
            res.json({
                success: true,
                data: {
                    schedules: schedule ? [schedule] : [],
                    conflicts: [],
                    holidays: [],
                },
            });
        } catch (error) { handleError(error, res, next); }
    }

    static async listSwaps(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.list(req.user!.companyId, {
                status: queryText(req.query.status), userId: queryId(req.query.userId),
            }, branchScope(req));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async mySwaps(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.list(req.user!.companyId, { status: queryText(req.query.status), userId: req.user!.userId });
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async createSwap(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.create(req.user!.companyId, req.body, req.user!.userId);
            res.status(201).json({ success: true, data, message: 'Solicitud de intercambio creada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async respondSwap(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.respond(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.decision);
            res.json({ success: true, data, message: 'Solicitud respondida' });
        } catch (error) { handleError(error, res, next); }
    }

    static async approveSwap(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.approve(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.notes, branchScope(req));
            res.json({ success: true, data, message: 'Intercambio aprobado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async cancelMySwap(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.cancel(Number(req.params.id), req.user!.companyId, req.user!.userId, false);
            res.json({ success: true, data, message: 'Solicitud cancelada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async cancelManagedSwap(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ShiftSwapService.cancel(Number(req.params.id), req.user!.companyId, req.user!.userId, true);
            res.json({ success: true, data, message: 'Solicitud cancelada por administración' });
        } catch (error) { handleError(error, res, next); }
    }

    static async listCalendars(req: Request, res: Response, next: NextFunction) {
        try { res.json({ success: true, data: await HolidayService.listCalendars(req.user!.companyId, branchScope(req)) }); }
        catch (error) { handleError(error, res, next); }
    }

    static async listHolidays(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = queryId(req.query.branchId);
            const data = await HolidayService.listHolidays(req.user!.companyId, {
                calendarId: queryId(req.query.calendarId), branchId: requestedBranchId,
                dateFrom: queryText(req.query.dateFrom), dateTo: queryText(req.query.dateTo),
                weekStart: queryText(req.query.weekStart),
            }, branchScope(req, requestedBranchId));
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async createCalendar(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await HolidayService.createCalendar(req.user!.companyId, req.body, req.user!.userId, branchScope(req));
            res.status(201).json({ success: true, data, message: 'Calendario creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async updateCalendar(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await HolidayService.updateCalendar(Number(req.params.id), req.user!.companyId, req.body, req.user!.userId, branchScope(req));
            res.json({ success: true, data, message: 'Calendario actualizado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async createHoliday(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await HolidayService.createHoliday(Number(req.params.id), req.user!.companyId, req.body, req.user!.userId, branchScope(req, queryId(req.body.branchId)));
            res.status(201).json({ success: true, data, message: 'Feriado creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async updateHoliday(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await HolidayService.updateHoliday(Number(req.params.id), req.user!.companyId, req.body, req.user!.userId, branchScope(req));
            res.json({ success: true, data, message: 'Feriado actualizado' });
        } catch (error) { handleError(error, res, next); }
    }
}
