import { Router } from 'express';
import { ExportController } from '../controllers/export.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validateQueryDates } from '../middlewares/validate-query-dates';

const router = Router();

// All export routes require authentication
router.use(authMiddleware);
router.use(validateQueryDates('startDate', 'endDate'));

// Export routes - require ADMIN or SUPERADMIN role
router.get('/sales', requireRole('SUPERADMIN', 'ADMIN'), ExportController.exportSales);
router.get('/inventory', requireRole('SUPERADMIN', 'ADMIN'), ExportController.exportInventory);
router.get('/top-products', requireRole('SUPERADMIN', 'ADMIN'), ExportController.exportTopProducts);
router.get('/sales-by-user', requireRole('SUPERADMIN', 'ADMIN'), ExportController.exportSalesByUser);

export default router;
