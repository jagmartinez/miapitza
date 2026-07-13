import { Router, Request, Response, NextFunction } from 'express';
import { BackupController } from '../controllers/backup.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

export const requireBackupOperator = (req: Request, res: Response, next: NextFunction) => {
    const configured = process.env.BACKUP_ADMIN_COMPANY_ID;
    const operatorCompanyId = configured ? Number(configured) : NaN;
    if (!Number.isInteger(operatorCompanyId) || operatorCompanyId <= 0) {
        return res.status(503).json({ success: false, message: 'La API de respaldos no tiene un operador global configurado' });
    }
    if (req.user!.companyId !== operatorCompanyId) {
        return res.status(403).json({ success: false, message: 'Esta empresa no está autorizada para operar respaldos globales' });
    }
    next();
};

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN'));
router.use(requireBackupOperator);

router.post('/create', BackupController.createBackup);
router.get('/list', BackupController.listBackups);
router.get('/download/:filename', validate(s.filenameParam), BackupController.downloadBackup);
router.delete('/:filename', validate(s.filenameParam), BackupController.deleteBackup);

export default router;
