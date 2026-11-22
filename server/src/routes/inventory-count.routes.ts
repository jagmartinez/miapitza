import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, requirePermission, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { InventoryCountService } from '../services/inventory-count.service';
import { InventoryCountError } from '../services/inventory-count-errors';
import { requireIdempotencyKey } from './inventory-movement.routes';

const router = Router();

router.use(authMiddleware);

const actorOf = (req: Request) => req.user as NonNullable<Request['user']>;
const q = (req: Request) => req.query as Record<string, unknown>;

const positiveInt = (v: unknown): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    return n;
};

/**
 * Typed count errors answer with `details` as an object (`{ sheetId }`,
 * `{ products }`), which the shared error handler reserves for field issues.
 */
function sendCountError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof InventoryCountError) {
        res.status(error.statusCode).json({
            success: false,
            message: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
        });
        return;
    }
    next(error);
}

const handle = (status: number, fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(status).json({ success: true, data: await fn(req) });
    } catch (error) {
        sendCountError(error, res, next);
    }
};

router.get('/warehouses', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), handle(200, (req) =>
    InventoryCountService.warehouses(actorOf(req))));

router.get('/warehouses/:id/categories', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), handle(200, (req) => {
    const id = positiveInt(req.params.id);
    if (id === undefined) throw new InventoryCountError('INVENTORY_COUNT_INVALID');
    return InventoryCountService.categories(actorOf(req), id);
}));

router.post('/', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), validate({
    body: {
        warehouseId: { type: 'number', required: true, min: 1, integer: true },
        // Entries (integer or null for "Sin categoría") are checked in the service.
        categoryIds: { type: 'array' },
    },
}), handle(201, (req) => InventoryCountService.start(actorOf(req), req.body ?? {})));

router.get('/', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), handle(200, (req) =>
    InventoryCountService.list(actorOf(req), {
        status: typeof q(req).status === 'string' && q(req).status !== '' ? (q(req).status as string) : undefined,
        page: positiveInt(q(req).page),
        pageSize: positiveInt(q(req).pageSize),
    })));

const REVIEWERS = ['SUPERADMIN', 'ADMIN'] as const;

// Review routes (static `/review` before `/:id`).
router.get('/review', requireRole(...REVIEWERS), handle(200, (req) =>
    InventoryCountService.reviewList(actorOf(req), {
        status: q(req).status,
        branchId: positiveInt(q(req).branchId),
        dateFrom: q(req).dateFrom,
        dateTo: q(req).dateTo,
        page: positiveInt(q(req).page),
    })));

router.get('/:id/review', requireRole(...REVIEWERS), handle(200, (req) =>
    InventoryCountService.reviewDetail(actorOf(req), positiveInt(req.params.id))));

router.post('/:id/recount', requireRole(...REVIEWERS), validate({
    body: {
        productIds: { type: 'array', required: true },
        note: { type: 'string', max: 500 },
    },
}), handle(200, (req) => InventoryCountService.recount(actorOf(req), positiveInt(req.params.id), req.body ?? {})));

router.post('/:id/reject', requireRole(...REVIEWERS), validate({
    body: { reason: { type: 'string', required: true, min: 3, max: 500 } },
}), handle(200, (req) => InventoryCountService.reject(actorOf(req), positiveInt(req.params.id), req.body ?? {})));

router.post('/:id/approve', requireRole(...REVIEWERS), requireIdempotencyKey, handle(200, (req) =>
    InventoryCountService.approve(actorOf(req), positiveInt(req.params.id))));

router.get('/:id', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), handle(200, (req) =>
    InventoryCountService.detail(actorOf(req), positiveInt(req.params.id))));

router.put('/:id/lines/:productId', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), requireIdempotencyKey, validate({
    body: {
        unit: { type: 'string', required: true, min: 1, max: 20 },
        // countedQuantity (number >= 0 with up to 3 decimals, or null to clear) is checked strictly in the service.
        countedQuantity: { type: 'number' },
        clientCountedAt: { type: 'date', required: true },
    },
}), handle(200, (req) =>
    InventoryCountService.saveLine(actorOf(req), positiveInt(req.params.id), positiveInt(req.params.productId), req.body ?? {})));

router.post('/:id/submit', requirePermission('inventory.count', 'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'), handle(200, (req) =>
    InventoryCountService.submit(actorOf(req), positiveInt(req.params.id))));

export default router;
