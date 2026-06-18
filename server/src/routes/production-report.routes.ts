import { Router } from 'express';
import { ProductionReportController } from '../controllers/production-report.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { ADMINS } from '../constants/roles';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(...ADMINS, 'BODEGA', 'CHEF'));

router.get('/dashboard', ProductionReportController.getDashboard);
router.get('/productions', ProductionReportController.getProductions);
router.get('/input-consumption', ProductionReportController.getInputConsumption);
router.get('/plan-vs-real', ProductionReportController.getPlanVsReal);
router.get('/produced-kardex', ProductionReportController.getProducedKardex);
router.get('/profitability', ProductionReportController.getProfitability);
router.get('/traceability/:orderId', ProductionReportController.getTraceability);

export default router;
