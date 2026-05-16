import { Router } from 'express';
import { ReportController } from '../controllers/report.controller';
import { ReportExtendedController } from '../controllers/report-extended.controller';
import { ReportProductionController } from '../controllers/report-production.controller';
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

// ── Reportería endpoints ──
router.get('/inventory', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getInventoryReport);
router.get('/inventory/export', requireRole('SUPERADMIN', 'ADMIN'), ReportController.exportInventoryReport);
router.get('/purchases', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getPurchasesReport);
router.get('/purchases/export', requireRole('SUPERADMIN', 'ADMIN'), ReportController.exportPurchasesReport);
router.get('/sales', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getSalesReport);
router.get('/sales/export', requireRole('SUPERADMIN', 'ADMIN'), ReportController.exportSalesReport);
router.get('/profitability', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getProfitabilityReport);
router.get('/profitability/export', requireRole('SUPERADMIN', 'ADMIN'), ReportController.exportProfitabilityReport);
router.get('/low-stock', requireRole('SUPERADMIN', 'ADMIN'), ReportController.getLowStockReport);
router.get('/low-stock/export', requireRole('SUPERADMIN', 'ADMIN'), ReportController.exportLowStockReport);

// ── Extended Purchase Reports ──
router.get('/purchases-by-day', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getPurchasesByDay);
router.get('/purchases-by-day/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportPurchasesByDay);
router.get('/purchases-by-month', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getPurchasesByMonth);
router.get('/purchases-by-month/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportPurchasesByMonth);
router.get('/price-comparison', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getPriceComparison);
router.get('/price-comparison/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportPriceComparison);
router.get('/most-purchased', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getMostPurchasedProducts);
router.get('/most-purchased/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportMostPurchasedProducts);
router.get('/purchases-by-supplier', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getPurchasesBySupplier);
router.get('/purchases-by-supplier/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportPurchasesBySupplier);

// ── Extended Sales Reports ──
router.get('/sales-by-category', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesByCategory);
router.get('/sales-by-category/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesByCategory);
router.get('/sales-daily', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesDaily);
router.get('/sales-daily/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesDaily);
router.get('/sales-monthly', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesMonthly);
router.get('/sales-monthly/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesMonthly);
router.get('/sales-by-payment-method', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesByPaymentMethod);
router.get('/sales-by-payment-method/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesByPaymentMethod);
router.get('/sales-by-waiter', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesByWaiter);
router.get('/sales-by-waiter/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesByWaiter);
router.get('/sales-by-channel', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesByChannel);
router.get('/sales-by-channel/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesByChannel);
router.get('/sales-by-hour', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getSalesByHour);
router.get('/sales-by-hour/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportSalesByHour);

// ── Cost Reports ──
router.get('/food-cost-by-category', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getFoodCostByCategory);
router.get('/food-cost-by-category/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportFoodCostByCategory);
router.get('/margin-by-product', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getMarginByProduct);
router.get('/margin-by-product/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportMarginByProduct);

// ── Audit Reports ──
router.get('/audit', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getAuditReport);
router.get('/audit/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportAuditReport);

// ── Decision Reports ──
router.get('/day-analysis', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getDayAnalysis);
router.get('/day-analysis/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportDayAnalysis);
router.get('/month-comparison', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.getMonthComparison);
router.get('/month-comparison/export', requireRole('SUPERADMIN', 'ADMIN'), ReportExtendedController.exportMonthComparison);

// ── Production & Engineering Reports ──
router.get('/recipe-cost', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.getRecipeCostAnalysis);
router.get('/recipe-cost/export', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.exportRecipeCostAnalysis);
router.get('/production-yield', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.getProductionYield);
router.get('/production-yield/export', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.exportProductionYield);
router.get('/menu-engineering', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.getMenuEngineering);
router.get('/menu-engineering/export', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.exportMenuEngineering);
router.get('/purchase-projection', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.getPurchaseProjection);
router.get('/purchase-projection/export', requireRole('SUPERADMIN', 'ADMIN'), ReportProductionController.exportPurchaseProjection);

export default router;
