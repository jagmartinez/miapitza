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
// The current OAuth/menu/mapping/log models are company-wide. Only the
// company-wide operator may use them; branch ADMIN remains limited to its
// branch-specific configuration above.
router.post('/test-connection', requireRole('SUPERADMIN'), PedidosYaController.testConnection);
router.post('/sync-menu', requireRole('SUPERADMIN'), PedidosYaController.syncMenu);

// Product mappings
router.get('/mappings', requireRole('SUPERADMIN'), PedidosYaController.getMappings);
router.put('/mappings', requireRole('SUPERADMIN'), PedidosYaController.upsertMapping);
router.delete('/mappings/:id', requireRole('SUPERADMIN'), PedidosYaController.deleteMapping);

// Logs & syncs
router.get('/webhook-logs', requireRole('SUPERADMIN'), PedidosYaController.getWebhookLogs);
router.get('/order-syncs', requireRole('SUPERADMIN'), PedidosYaController.getOrderSyncs);

export default router;
