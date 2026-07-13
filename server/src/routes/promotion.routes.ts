import { Router, Request, Response, NextFunction } from 'express';
import { PromotionService } from '../services/promotion.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/promotions:
 *   get:
 *     summary: Get all promotions
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const activeOnly = req.query.activeOnly !== 'false';

        const promotions = await PromotionService.getAll(companyId, activeOnly);

        res.json({
            success: true,
            data: promotions
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/promotions/validate:
 *   post:
 *     summary: Validate a promotion code
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 */
router.post('/validate', validate(s.validatePromotion), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code, orderTotal } = req.body;

        if (!code || orderTotal === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Código y total de orden son requeridos'
            });
        }
        const parsedOrderTotal = Number(orderTotal);
        if (!Number.isFinite(parsedOrderTotal) || parsedOrderTotal < 0) {
            return res.status(400).json({
                success: false,
                message: 'Total de orden inválido'
            });
        }

        const companyId = req.user!.companyId;
        const result = await PromotionService.validateAndApply(code, parsedOrderTotal, companyId);

        res.json({
            success: result.valid,
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/promotions:
 *   post:
 *     summary: Create a new promotion
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', requireRole('ADMIN', 'SUPERADMIN'), validate(s.createPromotion), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const promotion = await PromotionService.create(companyId, req.body);

        res.status(201).json({
            success: true,
            message: 'Promoción creada exitosamente',
            data: promotion
        });
    } catch (error: unknown) {
        next({ statusCode: 400, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/promotions/{id}:
 *   put:
 *     summary: Update a promotion
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), validate(s.updatePromotion), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id);
        const companyId = req.user!.companyId;
        const promotion = await PromotionService.update(id, companyId, req.body);

        res.json({
            success: true,
            message: 'Promoción actualizada',
            data: promotion
        });
    } catch (error: unknown) {
        next({ statusCode: 400, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/promotions/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a promotion
 *     tags: [Promotions]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:id/deactivate', requireRole('ADMIN', 'SUPERADMIN'), validate(s.idParam), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id);
        const companyId = req.user!.companyId;
        await PromotionService.deactivate(id, companyId);

        res.json({
            success: true,
            message: 'Promoción desactivada'
        });
    } catch (error: unknown) {
        next({ statusCode: 400, message: getErrorMessage(error) });
    }
});

export default router;
