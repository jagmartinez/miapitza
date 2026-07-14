import { Router } from 'express';
import { CompanyController } from '../controllers/company.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN'));

router.get('/', CompanyController.getAll);
router.get('/:id', validate(s.idParam), CompanyController.getById);
router.post('/', validate(s.createCompany), CompanyController.create);
router.put('/:id', validate(s.updateCompany), CompanyController.update);

export default router;
