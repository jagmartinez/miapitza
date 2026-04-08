import { Router } from 'express';
import { ReportController } from '../controllers/report.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/dashboard-stats', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getDashboardStats);
router.get('/sales-chart', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getSalesChart);
router.get('/top-products', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getTopSellingProducts);
router.get('/sales-by-user', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getSalesByUser);
router.get('/recent-orders', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getRecentOrders);
router.get('/recent-invoices', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getRecentInvoices);
router.get('/todays-reservations', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getTodaysReservations);
router.get('/income-breakdown', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getIncomeBreakdown);
router.get('/occupancy-heatmap', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getOccupancyHeatmap);
router.get('/shift-evaluation', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getShiftEvaluation);
router.get('/conversion-funnel', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getConversionFunnel);
router.get('/service-trends', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getServiceTrends);
router.get('/my-stats', ReportController.getMyStats);
router.get('/my-activity', ReportController.getMyActivity);
router.get('/my-performance', ReportController.getMyPerformance);
router.get('/my-password-info', ReportController.getPasswordInfo);
router.get('/costs', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getCostReport);

export default router;
