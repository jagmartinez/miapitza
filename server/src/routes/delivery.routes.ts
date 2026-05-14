import { Router, Request, Response, NextFunction } from 'express';
import { DeliveryService, type DeliveryStatusUpdate } from '../services/delivery.service';

function toPlatformApiStatus(mapped: string): DeliveryStatusUpdate['status'] {
    switch (mapped) {
        case 'ACCEPTED':
        case 'PREPARING':
        case 'READY_FOR_PICKUP':
        case 'PICKED_UP':
        case 'DELIVERED':
        case 'CANCELLED':
            return mapped;
        default:
            return 'ACCEPTED';
    }
}
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';

const router = Router();

/**
 * @swagger
 * /api/delivery/webhook/{platform}:
 *   post:
 *     summary: Receive orders from delivery platforms
 *     tags: [Delivery]
 *     parameters:
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *           enum: [uber-eats, rappi, pedidosya]
 */
router.post('/webhook/:platform', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { platform } = req.params;
        const signature = req.headers['x-webhook-signature'] as string || '';
        const rawPayload = (req as Request & { rawBody?: string }).rawBody;
        const payload = rawPayload && rawPayload.trim().length > 0
            ? rawPayload
            : JSON.stringify(req.body);
        const companyIdHeader = req.headers['x-company-id'];
        const branchIdHeader = req.headers['x-branch-id'];
        const companyId = Number(Array.isArray(companyIdHeader) ? companyIdHeader[0] : companyIdHeader);
        const branchId = Number(Array.isArray(branchIdHeader) ? branchIdHeader[0] : branchIdHeader);

        // Validate webhook signature
        if (!DeliveryService.validateWebhookSignature(platform, signature, payload)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(branchId) || branchId <= 0) {
            return res.status(400).json({
                error: 'Missing or invalid tenant headers. x-company-id and x-branch-id are required.'
            });
        }

        // Map platform name to enum
        type DeliveryPlatform = 'UBER_EATS' | 'RAPPI' | 'PEDIDOSYA' | 'OTHER';
        const platformMap: Record<string, DeliveryPlatform> = {
            'uber-eats': 'UBER_EATS',
            'rappi': 'RAPPI',
            'pedidosya': 'PEDIDOSYA'
        };

        const platformEnum: DeliveryPlatform = platformMap[platform] ?? 'OTHER';

        const deliveryOrder = {
            externalId: req.body.id || req.body.order_id || 'unknown',
            platform: platformEnum,
            customerName: req.body.customer?.name || req.body.customer_name || 'Cliente Delivery',
            customerPhone: req.body.customer?.phone || req.body.customer_phone,
            customerAddress: req.body.delivery_address || req.body.address || 'Dirección pendiente',
            items: req.body.items || [],
            total: req.body.total || 0,
            deliveryFee: req.body.delivery_fee,
            notes: req.body.notes || req.body.special_instructions
        };

        const order = await DeliveryService.processIncomingOrder(companyId, branchId, deliveryOrder);

        res.json({
            success: true,
            message: 'Order received',
            data: {
                internalOrderId: order.id,
                externalOrderId: deliveryOrder.externalId
            }
        });
    } catch (error: unknown) {
        console.error('Webhook error:', error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/delivery/{orderId}/status:
 *   put:
 *     summary: Update order status and notify delivery platform
 *     tags: [Delivery]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:orderId/status', authMiddleware, validate(s.updateDeliveryStatus), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status, platform, externalOrderId } = req.body;

        // Send status update to platform
        const result = await DeliveryService.sendStatusUpdate(
            platform,
            externalOrderId,
            toPlatformApiStatus(DeliveryService.mapStatusToPlatform(platform, status))
        );

        res.json({
            success: true,
            message: 'Status update sent',
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/delivery/config:
 *   get:
 *     summary: Get delivery platform configuration
 *     tags: [Delivery]
 *     security:
 *       - bearerAuth: []
 */
router.get('/config', authMiddleware, requireRole('ADMIN', 'SUPERADMIN'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const config = await DeliveryService.getConfiguration(companyId);

        res.json({
            success: true,
            data: config
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
