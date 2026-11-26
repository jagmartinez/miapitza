import { Request, Response, NextFunction } from 'express';
import { SettingService } from '../services/setting.service';
import { getErrorMessage } from '../utils/error';
import prisma from '../utils/prisma';
import { assertBranchAccess, BranchScopeError, isCompanyWide } from '../utils/branch-scope';
import { SETTINGS_REGISTRY, SETTINGS_SECTIONS } from '../constants/settings-registry';
import { SettingConflictError, SettingsScopeService, SettingValidationError } from '../services/settings-scope.service';

class SettingBranchNotFoundError extends Error {
    statusCode = 404;
    constructor() {
        super('Sucursal no encontrada');
    }
}

/** Parses an optional branch id and checks it belongs to the caller's company and is reachable by the caller. */
async function resolveSettingsBranch(req: Request, raw: unknown): Promise<number | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    const branchId = Number(raw);
    if (!Number.isInteger(branchId) || branchId <= 0) throw new SettingBranchNotFoundError();
    const branch = await prisma.branch.findFirst({
        where: { id: branchId, companyId: req.user!.companyId },
        select: { id: true }
    });
    if (!branch) throw new SettingBranchNotFoundError();
    assertBranchAccess(req.user!, branchId);
    return branchId;
}

function handleScopedError(error: unknown, res: Response, next: NextFunction) {
    if (error instanceof SettingValidationError) {
        return res.status(400).json({ success: false, message: error.message, errors: error.errors });
    }
    if (error instanceof SettingConflictError) {
        return res.status(409).json({ success: false, message: error.message });
    }
    if (error instanceof SettingBranchNotFoundError || error instanceof BranchScopeError) {
        return next({ statusCode: error.statusCode, message: error.message });
    }
    return next({ statusCode: 500, message: getErrorMessage(error) });
}

export class SettingController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const settings = await SettingService.getAll(companyId);
            res.json({
                success: true,
                data: settings
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const settings = await SettingService.update(companyId, req.body);
            res.json({
                success: true,
                data: settings
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getRegistry(_req: Request, res: Response) {
        res.json({ success: true, data: { sections: SETTINGS_SECTIONS, definitions: SETTINGS_REGISTRY } });
    }

    static async getResolved(req: Request, res: Response, next: NextFunction) {
        try {
            const branchId = await resolveSettingsBranch(req, req.query.branchId);
            const data = await SettingsScopeService.resolveWithVersion(req.user!.companyId, branchId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            handleScopedError(error, res, next);
        }
    }

    static async patchResolved(req: Request, res: Response, next: NextFunction) {
        try {
            const { branchId: rawBranchId, version, changes } = req.body ?? {};
            if (typeof version !== 'string' || !version) {
                return res.status(400).json({ success: false, message: 'Falta la versión de la configuración', errors: { version: 'Requerido' } });
            }
            if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
                return res.status(400).json({ success: false, message: 'Faltan los cambios a guardar', errors: { changes: 'Requerido' } });
            }
            const branchId = await resolveSettingsBranch(req, rawBranchId);
            const result = await SettingsScopeService.update(
                req.user!.companyId,
                branchId,
                req.user!.userId,
                changes,
                version
            );
            res.json({ success: true, data: { values: result.resolved, version: result.version } });
        } catch (error: unknown) {
            handleScopedError(error, res, next);
        }
    }

    static async getHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const data = await SettingsScopeService.history(req.user!.companyId, {
                section: typeof req.query.section === 'string' ? req.query.section : undefined,
                key: typeof req.query.key === 'string' ? req.query.key : undefined,
                limit: Number.isFinite(limit) ? limit : undefined,
                // Branch-pinned users only see company-wide entries and their own branch.
                branchIds: isCompanyWide(req.user!) ? undefined : (req.user!.branchId ? [req.user!.branchId] : [])
            });
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
