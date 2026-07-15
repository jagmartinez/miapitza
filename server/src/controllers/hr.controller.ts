import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
    HrDomainError,
    HrCatalogService,
    HrEmployeeService,
    HrGeofenceService,
    HrOverviewService,
    type EmployeeWriteInput,
} from '../services/hr.service';
import {
    assertBranchAccess,
    BranchScopeError,
    isCompanyWide,
    resolveBranchScope,
} from '../utils/branch-scope';

function positiveQueryId(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function employeeScope(req: Request, requestedBranchId?: number): number | undefined {
    return resolveBranchScope(req.user!, requestedBranchId);
}

function assertEmployeeWriteScope(req: Request, input: EmployeeWriteInput, creating: boolean): void {
    if (isCompanyWide(req.user!)) return;
    const branchId = resolveBranchScope(req.user!);
    if (input.branchIds === undefined) {
        if (creating) throw new BranchScopeError('El empleado debe asignarse a la sucursal activa del usuario');
        return;
    }
    const unique = Array.from(new Set(input.branchIds.map(Number)));
    if (unique.length !== 1 || unique[0] !== branchId || input.primaryBranchId !== branchId) {
        throw new BranchScopeError('No autorizado para asignar personal a otra sucursal');
    }
}

function handleHrError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof HrDomainError || error instanceof BranchScopeError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Ya existe un registro con ese código o vínculo' });
            return;
        }
        if (error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'La referencia indicada no es válida' });
            return;
        }
    }
    next(error);
}

export class HrController {
    static async dashboard(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await HrOverviewService.dashboard(req.user!.companyId, employeeScope(req));
            res.json({ success: true, data });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async lookups(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = employeeScope(req);
            const data = await HrOverviewService.lookups(req.user!.companyId, branchId);
            res.json({ success: true, data });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async listEmployees(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = positiveQueryId(req.query.branchId);
            const branchId = employeeScope(req, requestedBranchId);
            const result = await HrEmployeeService.list(req.user!.companyId, {
                search: typeof req.query.search === 'string' ? req.query.search : undefined,
                status: typeof req.query.status === 'string' ? req.query.status : undefined,
                departmentId: positiveQueryId(req.query.departmentId),
                jobPositionId: positiveQueryId(req.query.jobPositionId),
                costCenterId: positiveQueryId(req.query.costCenterId),
                branchId,
                page: positiveQueryId(req.query.page),
                limit: positiveQueryId(req.query.limit),
            });
            res.json({ success: true, data: result.data, pagination: result.pagination });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async getEmployee(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = employeeScope(req);
            const data = await HrEmployeeService.getById(Number(req.params.id), req.user!.companyId, {
                branchId,
                sensitive: true,
            });
            res.json({ success: true, data });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async createEmployee(req: Request, res: Response, next: NextFunction) {
        try {
            const input = req.body as EmployeeWriteInput;
            assertEmployeeWriteScope(req, input, true);
            const data = await HrEmployeeService.create(
                req.user!.companyId,
                input,
                req.user!.userId,
                employeeScope(req),
            );
            res.status(201).json({ success: true, data, message: 'Empleado creado' });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async updateEmployee(req: Request, res: Response, next: NextFunction) {
        try {
            const input = req.body as EmployeeWriteInput;
            assertEmployeeWriteScope(req, input, false);
            const branchId = employeeScope(req);
            const data = await HrEmployeeService.update(
                Number(req.params.id),
                req.user!.companyId,
                input,
                req.user!.userId,
                req.user!.timezone,
                branchId,
            );
            res.json({ success: true, data, message: 'Empleado actualizado' });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async setEmployeeStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = employeeScope(req);
            const data = await HrEmployeeService.setStatus(
                Number(req.params.id),
                req.user!.companyId,
                req.body.status,
                req.body.terminationDate,
                req.body.reason,
                req.user!.userId,
                req.user!.timezone,
                branchId,
            );
            res.json({ success: true, data, message: 'Estado laboral actualizado' });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static listCatalog(kind: 'department' | 'jobPosition' | 'costCenter') {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                const data = await HrCatalogService.list(kind, req.user!.companyId);
                res.json({ success: true, data });
            } catch (error) {
                handleHrError(error, res, next);
            }
        };
    }

    static createCatalog(kind: 'department' | 'jobPosition' | 'costCenter') {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                const data = await HrCatalogService.create(kind, req.user!.companyId, req.body, req.user!.userId);
                res.status(201).json({ success: true, data, message: 'Registro creado' });
            } catch (error) {
                handleHrError(error, res, next);
            }
        };
    }

    static updateCatalog(kind: 'department' | 'jobPosition' | 'costCenter') {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                const data = await HrCatalogService.update(
                    kind,
                    Number(req.params.id),
                    req.user!.companyId,
                    req.body,
                    req.user!.userId,
                );
                res.json({ success: true, data, message: 'Registro actualizado' });
            } catch (error) {
                handleHrError(error, res, next);
            }
        };
    }

    static async createBranch(req: Request, res: Response, next: NextFunction) {
        try {
            if (!isCompanyWide(req.user!)) {
                throw new BranchScopeError('Crear sucursales requiere alcance Owner de empresa');
            }
            const data = await HrGeofenceService.createBranch(
                req.user!.companyId,
                req.body,
                req.user!.userId,
            );
            res.status(201).json({ success: true, data, message: 'Sucursal y geocerca creadas' });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async getBranchGeofence(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = Number(req.params.id);
            assertBranchAccess(req.user!, branchId);
            const data = await HrGeofenceService.get(branchId, req.user!.companyId);
            res.json({ success: true, data });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }

    static async updateBranchGeofence(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = Number(req.params.id);
            assertBranchAccess(req.user!, branchId);
            const data = await HrGeofenceService.update(
                branchId,
                req.user!.companyId,
                req.body,
                req.user!.userId,
            );
            res.json({ success: true, data, message: 'Geocerca actualizada' });
        } catch (error) {
            handleHrError(error, res, next);
        }
    }
}
