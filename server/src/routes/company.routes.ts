import { Router } from 'express';
import { CompanyController } from '../controllers/company.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All company management routes require SUPERADMIN role
router.use(authMiddleware);
router.use(requireRole('SUPERADMIN'));

router.get('/', CompanyController.getAll);
router.get('/:id', CompanyController.getById);
router.post('/', CompanyController.create);
router.put('/:id', CompanyController.update);

export default router;
