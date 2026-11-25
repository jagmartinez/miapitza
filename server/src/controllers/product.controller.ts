import { Request, Response, NextFunction } from 'express';
import { ProductService } from '../services/product.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, BranchScopeError } from '../utils/branch-scope';

export class ProductController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type ProductFilters = NonNullable<Parameters<typeof ProductService.getAll>[1]>;
            const filters: ProductFilters = {};

            const requestedBranch = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requestedBranch);

            if (req.query.type) {
                const t = req.query.type as string;
                if (t === 'INGREDIENT' || t === 'PRODUCT_FOR_SALE' || t === 'BOTH' || t === 'INTERMEDIATE' || t === 'PACKAGING') {
                    filters.type = t;
                }
            }

            if (req.query.categoryId) {
                filters.categoryId = parseInt(req.query.categoryId as string);
            }

            if (req.query.storageType) {
                const st = req.query.storageType as string;
                if (st === 'PERISHABLE' || st === 'FROZEN' || st === 'NON_PERISHABLE') {
                    filters.storageType = st;
                }
            }

            if (req.query.active !== undefined) {
                filters.active = req.query.active === 'true';
            }

            if (req.query.page) filters.page = parseInt(req.query.page as string);
            if (req.query.limit) filters.limit = parseInt(req.query.limit as string);

            const result = await ProductService.getAll(companyId, filters);
            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination
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
            const product = await ProductService.getById(id, companyId);
            res.json({
                success: true,
                data: product
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getLowStock(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranch = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranch);
            const page = req.query.page ? parseInt(req.query.page as string) : undefined;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

            const products = await ProductService.getLowStock(companyId, branchId, page, limit);

            res.json({
                success: true,
                data: products
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            console.error('[ProductController.getLowStock] Error:', error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const product = await ProductService.create(companyId, req.body, req.user!.userId);
            res.status(201).json({
                success: true,
                message: 'Producto creado exitosamente',
                data: product
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const product = await ProductService.update(id, companyId, req.body, req.user!.userId);
            res.json({
                success: true,
                message: 'Producto actualizado exitosamente',
                data: product
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await ProductService.delete(id, companyId, req.user!.userId);
            res.json({
                success: true,
                message: 'Producto eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
