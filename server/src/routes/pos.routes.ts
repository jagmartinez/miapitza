import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authMiddleware } from '../middlewares/auth';
import { MenuAvailabilityService, type MenuAvailabilityDb } from '../services/menu-availability.service';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/v1/pos/menu-availability?warehouseId=
 * Solo lectura: por cada plato con receta, si hay insumos para al menos una porción en la bodega.
 * El POS usa el resultado solo como aviso; nunca bloquea la venta.
 */
router.get('/menu-availability', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const warehouseId = Number(req.query.warehouseId);
        if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
            return res.status(400).json({ success: false, message: 'warehouseId válido es requerido' });
        }
        const result = await MenuAvailabilityService.forWarehouse(prisma as unknown as MenuAvailabilityDb, {
            companyId: req.user!.companyId,
            warehouseId,
            branchId: req.user!.branchId ?? null,
        });
        if (!result) {
            return res.status(404).json({ success: false, message: 'Bodega no encontrada' });
        }
        return res.json({ success: true, data: result });
    } catch (error) {
        return next(error);
    }
});

export default router;
