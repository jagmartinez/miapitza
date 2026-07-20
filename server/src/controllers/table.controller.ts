import { Request, Response, NextFunction } from 'express';
import { TableService } from '../services/table.service';
import { WebSocketService } from '../services/websocket.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import { TableAccountService } from '../services/table-account.service';
import { TableFloorPlanService } from '../services/table-floor-plan.service';
import { TableGroupService } from '../services/table-group.service';

export class TableController {
    static async createGroup(req: Request, res: Response, next: NextFunction) {
        try {
            const ids = [Number(req.body.primaryTableId), ...(req.body.memberTableIds || []).map(Number)];
            for (const id of ids) {
                const table = await TableService.getById(id, req.user!.companyId);
                assertBranchAccess(req.user!, table.branchId);
            }
            const group = await TableGroupService.create(
                req.user!.companyId,
                req.user!.userId,
                { ...req.body, primaryTableId: ids[0], memberTableIds: ids.slice(1) }
            );
            if (!group) throw new Error('No se pudo crear el grupo de mesas');
            for (const table of group.activeTables) {
                WebSocketService.broadcastTableUpdate(table.id, 'GROUP_UPDATED', { groupId: group.id }, {
                    companyId: req.user!.companyId,
                    branchId: group.branchId
                });
            }
            res.status(201).json({ success: true, message: 'Mesas unidas físicamente', data: group });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 409, message: getErrorMessage(error) });
        }
    }

    static async closeGroup(req: Request, res: Response, next: NextFunction) {
        try {
            const existing = await TableGroupService.getById(req.user!.companyId, Number(req.params.id));
            assertBranchAccess(req.user!, existing.branchId);
            const group = await TableGroupService.close(
                req.user!.companyId,
                req.user!.userId,
                existing.id,
                req.body.reason
            );
            for (const table of group.tables) {
                WebSocketService.broadcastTableUpdate(table.id, 'GROUP_UPDATED', { groupId: group.id, closed: true }, {
                    companyId: req.user!.companyId,
                    branchId: group.branchId
                });
            }
            res.json({ success: true, message: 'Mesas separadas correctamente', data: group });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 409, message: getErrorMessage(error) });
        }
    }

    static async updateGroup(req: Request, res: Response, next: NextFunction) {
        try {
            const existing = await TableGroupService.getById(req.user!.companyId, Number(req.params.id));
            assertBranchAccess(req.user!, existing.branchId);
            const result = await TableGroupService.updateMembership(
                req.user!.companyId,
                req.user!.userId,
                existing.id,
                {
                    primaryTableId: req.body.primaryTableId,
                    expectedPrimaryTableId: req.body.expectedPrimaryTableId,
                    memberTableIds: req.body.memberTableIds,
                    expectedMemberTableIds: req.body.expectedMemberTableIds,
                    reason: req.body.reason
                }
            );
            for (const tableId of result.affectedTableIds) {
                WebSocketService.broadcastTableUpdate(tableId, 'GROUP_UPDATED', {
                    groupId: result.group.id,
                    memberTableIds: result.group.memberTableIds
                }, {
                    companyId: req.user!.companyId,
                    branchId: result.group.branchId
                });
            }
            res.json({ success: true, message: 'Grupo de mesas actualizado', data: result.group });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 409, message: getErrorMessage(error) });
        }
    }

    static async getFloorPlan(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = Number(req.params.branchId ?? req.user?.branchId);
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            if (!branchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            const plan = await TableFloorPlanService.getSnapshot(req.user!.companyId, branchId);
            res.json({ success: true, data: plan });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateFloorPlan(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = Number(req.params.branchId ?? req.user?.branchId);
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            if (!branchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            const plan = await TableFloorPlanService.save(
                req.user!.companyId,
                branchId,
                req.user!.userId,
                req.body
            );
            for (const table of plan.tables) {
                WebSocketService.broadcastTableUpdate(table.id, 'LAYOUT_UPDATED', { table, floorPlanVersion: plan.version }, {
                    companyId: req.user!.companyId,
                    branchId
                });
            }
            res.json({ success: true, message: 'Plano guardado correctamente', data: plan });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 409, message: getErrorMessage(error) });
        }
    }

    static async updateLayout(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = Number(req.body.branchId ?? req.user?.branchId);
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            if (!branchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            const tables = await TableAccountService.updateLayout(
                req.user!.companyId,
                branchId,
                req.user!.userId,
                req.body.tables
            );
            for (const table of tables) {
                WebSocketService.broadcastTableUpdate(table.id, 'LAYOUT_UPDATED', table, {
                    companyId: req.user!.companyId,
                    branchId
                });
            }
            res.json({ success: true, message: 'Plano de mesas actualizado', data: tables });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 409, message: getErrorMessage(error) });
        }
    }

    static async consolidate(req: Request, res: Response, next: NextFunction) {
        try {
            const destination = await TableService.getById(Number(req.body.destinationTableId), req.user!.companyId);
            assertBranchAccess(req.user!, destination.branchId);
            const sourceIds = Array.isArray(req.body.sourceTableIds) ? req.body.sourceTableIds.map(Number) : [];
            for (const sourceId of sourceIds) {
                const source = await TableService.getById(sourceId, req.user!.companyId);
                assertBranchAccess(req.user!, source.branchId);
            }
            const order = await TableAccountService.consolidate(
                req.user!.companyId,
                req.user!.userId,
                { ...req.body, sourceTableIds: sourceIds }
            );
            WebSocketService.broadcastOrderUpdate(order.id, 'TABLES_CONSOLIDATED', order, {
                companyId: req.user!.companyId,
                branchId: order.branchId
            });
            res.json({ success: true, message: 'Cuentas de mesas consolidadas', data: order });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async transfer(req: Request, res: Response, next: NextFunction) {
        try {
            const source = await TableService.getById(Number(req.body.sourceTableId), req.user!.companyId);
            const destination = await TableService.getById(Number(req.body.destinationTableId), req.user!.companyId);
            assertBranchAccess(req.user!, source.branchId);
            assertBranchAccess(req.user!, destination.branchId);
            const result = await TableAccountService.transfer(
                req.user!.companyId,
                req.user!.userId,
                req.body
            );
            WebSocketService.broadcastOrderUpdate(result.destinationOrder.id, 'TABLE_TRANSFERRED', result.destinationOrder, {
                companyId: req.user!.companyId,
                branchId: result.destinationOrder.branchId
            });
            res.json({ success: true, message: 'Consumo trasladado correctamente', data: result });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const tables = await TableService.getAll(companyId, branchId);
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const table = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, table.branchId);
            res.json({
                success: true,
                data: table
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
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            const tables = await TableService.getByBranch(branchId, companyId);
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Resolve target branch: non-superadmin users are pinned to their active branch.
            const requested = req.body.branchId ? Number(req.body.branchId) : req.user?.branchId;
            const branchId = resolveBranchScope(req.user!, requested);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            req.body.branchId = branchId;

            const table = await TableService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Mesa creada exitosamente',
                data: table
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
            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            const table = await TableService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Mesa actualizada exitosamente',
                data: table
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
            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            await TableService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Mesa eliminada exitosamente'
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
            const { status } = req.body;

            if (!status) {
                return next({ statusCode: 400, message: 'Estado es requerido' });
            }

            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            const table = await TableService.updateStatus(id, companyId, status);

            // Broadcast table status change
            WebSocketService.broadcastTableUpdate(id, status, table, {
                companyId,
                branchId: table.branchId
            });

            res.json({
                success: true,
                message: 'Estado de mesa actualizado exitosamente',
                data: table
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
