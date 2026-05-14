import { Router } from 'express';
import { BackupController } from '../controllers/backup.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN'));

router.post('/create', BackupController.createBackup);
router.get('/list', BackupController.listBackups);
router.get('/download/:filename', validate(s.filenameParam), BackupController.downloadBackup);
router.delete('/:filename', validate(s.filenameParam), BackupController.deleteBackup);

export default router;
