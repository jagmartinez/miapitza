import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
    AttendanceCorrectionService,
    AttendanceDerivedService,
    AttendanceIncidentService,
    AttendancePeriodService,
    HrWorkforceError,
    LeaveRequestService,
    LeaveTypeService,
    OvertimeService,
    VacationService,
    WorkforcePortalService,
} from '../services/hr-workforce.service';
import { BranchScopeError, isCompanyWide, resolveBranchScope } from '../utils/branch-scope';

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

function filters(req: Request) {
    return {
        date: queryText(req.query.date),
        dateFrom: queryText(req.query.dateFrom),
        dateTo: queryText(req.query.dateTo),
        branchId: queryId(req.query.branchId),
        userId: queryId(req.query.userId),
        status: queryText(req.query.status),
        page: queryId(req.query.page),
        limit: queryId(req.query.limit),
    };
}

function selfUserId(req: Request): number {
    if (req.user!.accountType !== 'INTERNAL' && !isCompanyWide(req.user!)) {
        throw new HrWorkforceError('El portal laboral requiere una cuenta interna ligada a un empleado', 403, 'HR_INTERNAL_ACCOUNT_REQUIRED');
    }
    return req.user!.userId;
}

function requireCompanyOwner(req: Request): void {
    if (!isCompanyWide(req.user!)) {
        throw new HrWorkforceError('Esta operación de RH requiere alcance Owner sobre toda la empresa', 403, 'HR_OWNER_SCOPE_REQUIRED');
    }
}

function idempotencyKey(req: Request): string {
    return String(req.get('Idempotency-Key') || '');
}

function sendList(res: Response, result: { items: unknown[]; pagination: unknown }) {
    res.json({ success: true, data: result.items, pagination: result.pagination });
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof HrWorkforceError || error instanceof BranchScopeError) {
        res.status(error.statusCode).json({
            success: false,
            code: error instanceof HrWorkforceError ? error.code : 'HR_BRANCH_SCOPE_FORBIDDEN',
            message: error.message,
        });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'El registro ya existe o fue procesado concurrentemente' });
            return;
        }
        if (error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'La referencia indicada no es válida' });
            return;
        }
    }
    next(error);
}

export class HrWorkforceController {
    static async dailySummaries(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const query = filters(req);
            query.branchId = resolveBranchScope(req.user!, query.branchId);
            sendList(res, await AttendanceDerivedService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async myAttendanceSummaries(req: Request, res: Response, next: NextFunction) {
        try {
            const query = filters(req);
            query.userId = selfUserId(req);
            query.branchId = undefined;
            sendList(res, await AttendanceDerivedService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async incidents(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const query = filters(req);
            query.branchId = resolveBranchScope(req.user!, query.branchId);
            sendList(res, await AttendanceIncidentService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async corrections(req: Request, res: Response, next: NextFunction) {
        try {
            const query = filters(req);
            if (!isCompanyWide(req.user!)) query.userId = selfUserId(req);
            sendList(res, await AttendanceCorrectionService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async createCorrection(req: Request, res: Response, next: NextFunction) {
        try {
            const forcedUserId = isCompanyWide(req.user!) ? undefined : selfUserId(req);
            const data = await AttendanceCorrectionService.create(
                req.user!.companyId,
                req.user!.userId,
                req.body,
                idempotencyKey(req),
                forcedUserId,
            );
            res.status(201).json({ success: true, data, message: 'Solicitud de corrección creada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async decideCorrection(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await AttendanceCorrectionService.decide(
                Number(req.params.id), req.user!.companyId, req.user!.userId,
                req.body.decision, req.body.reason, idempotencyKey(req),
            );
            res.json({ success: true, data, message: 'Corrección decidida mediante evento compensatorio' });
        } catch (error) { handleError(error, res, next); }
    }

    static async periods(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            sendList(res, await AttendancePeriodService.list(req.user!.companyId, filters(req)));
        }
        catch (error) { handleError(error, res, next); }
    }

    static async createPeriod(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await AttendancePeriodService.create(req.user!.companyId, req.user!.userId, req.body, idempotencyKey(req));
            res.status(201).json({ success: true, data, message: 'Período de asistencia creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async closePeriod(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await AttendancePeriodService.close(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.reason, idempotencyKey(req));
            res.json({ success: true, data, message: 'Período cerrado y habilitado como fuente de nómina' });
        } catch (error) { handleError(error, res, next); }
    }

    static async reopenPeriod(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await AttendancePeriodService.reopen(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.reason, idempotencyKey(req));
            res.json({ success: true, data, message: 'Período reabierto; dejó de ser elegible para nómina' });
        } catch (error) { handleError(error, res, next); }
    }

    static async overtime(req: Request, res: Response, next: NextFunction) {
        try {
            const query = filters(req);
            if (!isCompanyWide(req.user!)) query.userId = selfUserId(req);
            sendList(res, await OvertimeService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async createOvertime(req: Request, res: Response, next: NextFunction) {
        try {
            const forcedUserId = isCompanyWide(req.user!) ? undefined : selfUserId(req);
            const data = await OvertimeService.create(req.user!.companyId, req.user!.userId, req.body, idempotencyKey(req), forcedUserId);
            res.status(201).json({ success: true, data, message: 'Solicitud de horas extra creada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async decideOvertime(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await OvertimeService.decide(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body, idempotencyKey(req));
            res.json({ success: true, data, message: 'Solicitud de horas extra decidida' });
        } catch (error) { handleError(error, res, next); }
    }

    static async cancelOvertime(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await OvertimeService.cancel(
                Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.reason,
                idempotencyKey(req), !isCompanyWide(req.user!),
            );
            res.json({ success: true, data, message: 'Solicitud de horas extra cancelada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async leaveTypes(req: Request, res: Response, next: NextFunction) {
        try { res.json({ success: true, data: await LeaveTypeService.list(req.user!.companyId, queryBoolean(req.query.active)) }); }
        catch (error) { handleError(error, res, next); }
    }

    static async createLeaveType(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await LeaveTypeService.create(req.user!.companyId, req.user!.userId, req.body);
            res.status(201).json({ success: true, data, message: 'Tipo de ausencia creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async updateLeaveType(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await LeaveTypeService.update(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body);
            res.json({ success: true, data, message: 'Tipo de ausencia actualizado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async leaveRequests(req: Request, res: Response, next: NextFunction) {
        try {
            const query = filters(req);
            if (!isCompanyWide(req.user!)) {
                query.userId = selfUserId(req);
                query.branchId = undefined;
            }
            sendList(res, await LeaveRequestService.list(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async createLeaveRequest(req: Request, res: Response, next: NextFunction) {
        try {
            const forcedUserId = isCompanyWide(req.user!) ? undefined : selfUserId(req);
            const data = await LeaveRequestService.create(req.user!.companyId, req.user!.userId, req.body, forcedUserId);
            res.status(201).json({ success: true, data, message: 'Borrador de ausencia creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async submitLeaveRequest(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await LeaveRequestService.submit(Number(req.params.id), req.user!.companyId, req.user!.userId, !isCompanyWide(req.user!));
            res.json({ success: true, data, message: 'Solicitud de ausencia enviada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async decideLeaveRequest(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await LeaveRequestService.decide(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.decision, req.body.reason);
            res.json({ success: true, data, message: 'Solicitud de ausencia decidida' });
        } catch (error) { handleError(error, res, next); }
    }

    static async cancelLeaveRequest(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await LeaveRequestService.cancel(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.reason, !isCompanyWide(req.user!));
            res.json({ success: true, data, message: 'Solicitud de ausencia cancelada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async leaveCalendar(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const query = filters(req);
            query.branchId = resolveBranchScope(req.user!, query.branchId);
            res.json({ success: true, data: await LeaveRequestService.calendar(req.user!.companyId, query) });
        } catch (error) { handleError(error, res, next); }
    }

    static async vacationBalances(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const query = filters(req);
            query.branchId = resolveBranchScope(req.user!, query.branchId);
            res.json({ success: true, data: await VacationService.listBalances(req.user!.companyId, query) });
        } catch (error) { handleError(error, res, next); }
    }

    static async vacationLedger(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const query = filters(req);
            query.branchId = resolveBranchScope(req.user!, query.branchId);
            sendList(res, await VacationService.listLedger(req.user!.companyId, query));
        } catch (error) { handleError(error, res, next); }
    }

    static async createVacationAdjustment(req: Request, res: Response, next: NextFunction) {
        try {
            requireCompanyOwner(req);
            const data = await VacationService.adjust(req.user!.companyId, req.user!.userId, req.body, idempotencyKey(req));
            res.status(201).json({ success: true, data, message: 'Ajuste agregado al ledger inmutable' });
        } catch (error) { handleError(error, res, next); }
    }

    static async myWorkforce(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await WorkforcePortalService.getMyWorkforce(
                req.user!.companyId,
                selfUserId(req),
                req.user!.timezone,
                filters(req),
            );
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }
}
