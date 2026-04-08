import { Router } from 'express';
import { BackupController } from '../controllers/backup.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN'));

router.post('/create', BackupController.createBackup);
router.get('/list', BackupController.listBackups);
router.get('/download/:filename', BackupController.downloadBackup);
router.delete('/:filename', BackupController.deleteBackup);

export default router;
