import { Router } from 'express';
import { PedidosYaController } from '../controllers/pedidosya.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// Public webhook endpoint (no auth - validated by signature)
router.post('/webhook/:companyId', PedidosYaController.webhook);

// Authenticated management endpoints
router.use(authMiddleware);

router.get('/config', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.getConfig);
router.put('/config', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.upsertConfig);
router.post('/test-connection', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.testConnection);
router.post('/sync-menu', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.syncMenu);

// Product mappings
router.get('/mappings', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.getMappings);
router.put('/mappings', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.upsertMapping);
router.delete('/mappings/:id', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.deleteMapping);

// Logs & syncs
router.get('/webhook-logs', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.getWebhookLogs);
router.get('/order-syncs', requireRole('SUPERADMIN', 'ADMIN'), PedidosYaController.getOrderSyncs);

export default router;
