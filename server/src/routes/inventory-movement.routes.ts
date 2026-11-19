import { Router, type NextFunction, type Request, type Response } from 'express';
import { InventoryMovementController } from '../controllers/inventory-movement.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate, type ValidationSchema } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

/**
 * D14: manual movements, transfers and physical counts post stock. The global
 * /api idempotency middleware deduplicates a request only when it carries an
 * X-Idempotency-Key, so require one here: a double submit / network retry with
 * the same key replays the first response instead of posting twice.
 */
export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-idempotency-key'];
    if (typeof key !== 'string' || key.trim().length < 8 || key.length > 191) {
        res.status(428).json({
            success: false,
            message: 'X-Idempotency-Key es requerido (8 a 191 caracteres) para registrar movimientos de inventario'
        });
        return;
    }
    next();
}

const physicalCountSchema: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        warehouseId: { type: 'number', required: true, min: 1 },
        countedQuantity: { type: 'number', required: true, min: 0 },
        reason: { type: 'string', required: true, min: 3, max: 500 },
    },
};

router.use(authMiddleware);

router.get('/', InventoryMovementController.getAll);
router.get('/product/:productId/kardex', InventoryMovementController.getKardex);
router.get('/:id', validate(s.idParam), InventoryMovementController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), requireIdempotencyKey, validate(s.createInventoryMovement), InventoryMovementController.create);
router.post('/transfer', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), requireIdempotencyKey, validate(s.transferInventory), InventoryMovementController.transfer);
router.post('/count', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), requireIdempotencyKey, validate(physicalCountSchema), InventoryMovementController.physicalCount);
router.post('/:id/reverse', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.reverseInventoryMovement), InventoryMovementController.reverse);

export default router;
